import os
import json
import time
import hashlib
import ipaddress
import hmac
import secrets
import sqlite3
from typing import List, Literal, Optional, Dict, AsyncGenerator

import httpx
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="VOID AI", docs_url=None, redoc_url=None)

# --- CONFIG ---
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "dolphin-mistral")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

FREE_LIMIT = int(os.getenv("FREE_LIMIT", "2"))
FREE_TTL_SECONDS = int(os.getenv("FREE_TTL_SECONDS", str(24 * 60 * 60)))

RL_WINDOW_SECONDS = int(os.getenv("RL_WINDOW_SECONDS", "60"))
RL_MAX_REQUESTS = int(os.getenv("RL_MAX_REQUESTS", "30"))
RL_MAX_REQUESTS_IP = int(os.getenv("RL_MAX_REQUESTS_IP", "10"))
RL_MAX_REQUESTS_CID = int(os.getenv("RL_MAX_REQUESTS_CID", "20"))

DEV_RESET_ENABLED = os.getenv("DEV_RESET_ENABLED", "0") == "1"

BTCPAY_URL = os.getenv("BTCPAY_URL", "https://testnet.demo.btcpayserver.org")
BTCPAY_STORE_ID = os.getenv("BTCPAY_STORE_ID", "")
BTCPAY_API_KEY = os.getenv("BTCPAY_API_KEY", "")
BTCPAY_WEBHOOK_SECRET = os.getenv("BTCPAY_WEBHOOK_SECRET", "")

DB_PATH = os.getenv("DB_PATH", "void.db")

redis: Optional[Redis] = None

# --- MIDDLEWARE ---
app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:3000"], # Assicurati che corrisponda al frontend
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
  expose_headers=[
    "X-Free-Left",
    "X-Pro-Left",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "Retry-After",
  ],
)

# --- MODELS ---
class ChatMsg(BaseModel):
  role: Literal["system", "user", "assistant"]
  content: str

class ChatIn(BaseModel):
  messages: Optional[List[ChatMsg]] = None
  message: Optional[str] = None

class ProInvoiceIn(BaseModel):
  amount: str = "1"
  currency: str = "USD"
  credits: int = 1000

class ClaimIn(BaseModel):
  invoiceId: str

# --- DB HELPERS ---
def get_db():
  conn = sqlite3.connect(DB_PATH, timeout=10)
  conn.row_factory = sqlite3.Row
  return conn

def init_db():
  conn = get_db()
  c = conn.cursor()
  # Tabella token pro
  c.execute("""
    CREATE TABLE IF NOT EXISTS pro_tokens (
      token_hash TEXT PRIMARY KEY,
      credits_left INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  """)
  # Tabella fatture
  c.execute("""
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id TEXT PRIMARY KEY,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )
  """)
  # Tabella per tracciare chi ha già riscosso
  c.execute("""
    CREATE TABLE IF NOT EXISTS claims (
      invoice_id TEXT PRIMARY KEY,
      token_hash TEXT,
      claimed_at INTEGER NOT NULL
    )
  """)
  conn.commit()
  conn.close()

# --- UTILS ---
def _hash_token(token: str) -> str:
  return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _sha256(s: str) -> str:
  return hashlib.sha256(s.encode("utf-8")).hexdigest()

def _verify_btcpay_sig(raw_body: bytes, btcpay_sig: str, secret: str) -> bool:
  if not btcpay_sig or not btcpay_sig.startswith("sha256="):
    return False
  their = btcpay_sig.split("=", 1)[1].strip()
  mac = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
  return hmac.compare_digest(mac, their)

def _get_client_key(request: Request) -> str:
  cid = request.headers.get("x-void-client-id")
  if cid and len(cid) >= 8:
    return "cid:" + _sha256(cid)
  ip = request.client.host if request.client else "unknown"
  ua = request.headers.get("user-agent", "unknown")
  return "fpr:" + _sha256(ip + "|" + ua)

def _ip_bucket(request: Request) -> str:
  ip = (
    request.headers.get("cf-connecting-ip")
    or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
    or (request.client.host if request.client else "unknown")
  )
  try:
    addr = ipaddress.ip_address(ip)
    if addr.version == 4:
      net = ipaddress.ip_network(f"{ip}/24", strict=False)
    else:
      net = ipaddress.ip_network(f"{ip}/64", strict=False)
    return "ip:" + _sha256(str(net))
  except Exception:
    return "ip:" + _sha256(ip)

def _build_msgs(body: ChatIn) -> List[dict]:
  if body.messages and len(body.messages) > 0:
    return [m.model_dump() for m in body.messages]
  return [{"role": "user", "content": body.message or ""}]

# --- LUA SCRIPTS ---
FREE_LUA = """
local v = redis.call('GET', KEYS[1])
if not v then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  v = ARGV[1]
end
local n = tonumber(v)
if n <= 0 then
  return -1
end
n = redis.call('DECR', KEYS[1])
return n
"""

RL_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
local maxv = tonumber(ARGV[1])
if current > maxv then
  return {-1, ttl}
end
return {maxv - current, ttl}
"""

# --- LIFECYCLE ---
@app.on_event("startup")
async def _startup():
  global redis
  redis = Redis.from_url(REDIS_URL, decode_responses=True)
  init_db()

@app.on_event("shutdown")
async def _shutdown():
  global redis
  if redis is not None:
    await redis.close()

# --- LOGIC: LIMITS ---
async def _enforce_limits(request: Request) -> Dict[str, str]:
  if redis is None:
    raise HTTPException(status_code=503, detail="Redis not configured")

  ckey = _get_client_key(request)
  ipkey = _ip_bucket(request)
  window_id = int(time.time() // RL_WINDOW_SECONDS)

  rl_key_ip = f"rlip:{ipkey}:{window_id}"
  rl_key_cid = f"rlcid:{ckey}:{window_id}"

  rem_ip, ttl_ip = await redis.eval(RL_LUA, 1, rl_key_ip, RL_MAX_REQUESTS_IP, RL_WINDOW_SECONDS)
  rem_cid, ttl_cid = await redis.eval(RL_LUA, 1, rl_key_cid, RL_MAX_REQUESTS_CID, RL_WINDOW_SECONDS)

  # Handle possible list or int returns from Redis Lua
  if isinstance(rem_ip, list): rem_ip, ttl_ip = int(rem_ip[0]), int(rem_ip[1])
  else: rem_ip, ttl_ip = int(rem_ip), int(RL_WINDOW_SECONDS)
  
  if isinstance(rem_cid, list): rem_cid, ttl_cid = int(rem_cid[0]), int(rem_cid[1])
  else: rem_cid, ttl_cid = int(rem_cid), int(RL_WINDOW_SECONDS)

  headers: Dict[str, str] = {
    "X-RateLimit-Limit": str(RL_MAX_REQUESTS),
    "X-RateLimit-Remaining": str(min(max(rem_ip, 0), max(rem_cid, 0))),
  }

  if rem_ip < 0 or rem_cid < 0:
    headers["Retry-After"] = str(max(ttl_ip, ttl_cid))
    raise HTTPException(status_code=429, detail="Rate limit exceeded", headers=headers)

  # Check Pro Token
  pro = (request.headers.get("x-void-pro-token") or "").strip()
  if pro:
    th = _hash_token(pro)
    conn = get_db()
    try:
      row = conn.execute("SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)).fetchone()
      if not row:
        raise HTTPException(status_code=401, detail="Invalid pro token", headers=headers)

      if int(row[0]) <= 0:
        headers["X-Pro-Left"] = "0"
        raise HTTPException(status_code=402, detail="Pro credits exhausted", headers=headers)

      conn.execute("UPDATE pro_tokens SET credits_left = credits_left - 1 WHERE token_hash = ?", (th,))
      conn.commit()
      
      row = conn.execute("SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)).fetchone()
      left = int(row[0])
      headers["X-Pro-Left"] = str(left)
      return headers
    finally:
      conn.close()

  # Check Free Credits
  free_key = f"free:{ipkey}"
  new_left = await redis.eval(FREE_LUA, 1, free_key, FREE_LIMIT, FREE_TTL_SECONDS)
  new_left = int(new_left)

  headers["X-Free-Left"] = str(max(new_left, 0))
  if new_left < 0:
    raise HTTPException(status_code=402, detail="Free limit reached", headers=headers)

  return headers

# --- ROUTES: PAYMENT ---
@app.post("/pro/create-invoice")
async def pro_create_invoice(body: ProInvoiceIn):
  if not BTCPAY_STORE_ID or not BTCPAY_API_KEY:
    raise HTTPException(status_code=500, detail="BTCPay not configured")

  url = f"{BTCPAY_URL}/api/v1/stores/{BTCPAY_STORE_ID}/invoices"
  payload = {
    "amount": body.amount,
    "currency": body.currency,
    "metadata": {
      "orderId": f"voidpro-{int(time.time())}",
      "credits": body.credits,
    },
  }

  async with httpx.AsyncClient(timeout=30) as client:
    r = await client.post(
      url,
      headers={
        "Content-Type": "application/json",
        "Authorization": f"token {BTCPAY_API_KEY}",
      },
      json=payload,
    )

  if r.status_code >= 400:
    raise HTTPException(status_code=502, detail=f"BTCPay error {r.status_code}: {r.text}")

  data = r.json()
  invoice_id = data.get("id")
  checkout = data.get("checkoutLink") or (f"{BTCPAY_URL}/i/{invoice_id}" if invoice_id else None)

  # Save to DB
  conn = get_db()
  try:
    conn.execute(
      "INSERT OR IGNORE INTO invoices(invoice_id, credits, status, created_at) VALUES (?, ?, 'pending', ?)",
      (invoice_id, body.credits, int(time.time())),
    )
    conn.commit()
  finally:
    conn.close()

  return {"invoiceId": invoice_id, "checkoutLink": checkout}

@app.post("/btcpay/webhook")
async def btcpay_webhook(request: Request):
  if not BTCPAY_WEBHOOK_SECRET:
    raise HTTPException(status_code=500, detail="Webhook secret not configured")

  sig = request.headers.get("btcpay-sig", "")
  raw = await request.body()

  if not _verify_btcpay_sig(raw, sig, BTCPAY_WEBHOOK_SECRET):
    raise HTTPException(status_code=401, detail="Invalid signature")

  try:
    event = json.loads(raw.decode("utf-8"))
  except:
    return {"ok": True} # Ignore bad JSON

  invoice_id = event.get("invoiceId") or event.get("id")
  event_type = (event.get("type") or "").lower()

  if not invoice_id:
    return {"ok": True}

  # Process only confirmed/paid events
  if any(x in event_type for x in ["invoice_paid", "paid", "settled", "complete", "confirmed"]):
    conn = get_db()
    try:
      # Check if already processed or pending
      inv = conn.execute("SELECT status, credits FROM invoices WHERE invoice_id = ?", (invoice_id,)).fetchone()
      
      if inv and inv["status"] == "pending":
        # Generate token now
        credits = inv["credits"]
        token = "void_" + secrets.token_urlsafe(32)
        token_hash = _hash_token(token)

        # Save Token
        conn.execute(
          "INSERT INTO pro_tokens(token_hash, credits_left, created_at) VALUES (?, ?, ?)",
          (token_hash, credits, int(time.time())),
        )
        
        # Mark invoice as paid (store token hash just in case, though we use separate claims table usually)
        conn.execute(
          "UPDATE invoices SET status = 'paid' WHERE invoice_id = ?",
          (invoice_id,),
        )
        
        # We do NOT save the plain token to DB directly for security unless necessary, 
        # but we need to return it on claim. 
        # Strategy: Store the token in a separate 'unclaimed_tokens' table or just return it during claim generation.
        # Simpler: When webhook hits, we GENERATE the token and store it in a 'pending_claims' table.
        
        # For this specific architecture, let's update 'invoices' to include a 'token_plain' temporary or use a helper table.
        # Let's use a cleaner approach: The webhook updates status to paid. The /claim endpoint generates the token if paid.
        conn.execute("UPDATE invoices SET status = 'paid' WHERE invoice_id = ?", (invoice_id,))
        conn.commit()
        
    finally:
      conn.close()

  return {"ok": True}

@app.post("/pro/claim")
async def pro_claim(body: ClaimIn):
  conn = get_db()
  try:
    inv = conn.execute("SELECT status, credits FROM invoices WHERE invoice_id = ?", (body.invoiceId,)).fetchone()
    
    if not inv:
      raise HTTPException(status_code=404, detail="Invoice not found")
    
    if inv["status"] != "paid":
      raise HTTPException(status_code=402, detail="Invoice not paid yet")

    # Check if already claimed
    claimed = conn.execute("SELECT token_hash FROM claims WHERE invoice_id = ?", (body.invoiceId,)).fetchone()
    if claimed:
      raise HTTPException(status_code=409, detail="Token already claimed")

    # Generate Token
    token = "void_" + secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    credits = inv["credits"]

    # Atomically save token and claim
    conn.execute("INSERT INTO pro_tokens(token_hash, credits_left, created_at) VALUES (?, ?, ?)", (token_hash, credits, int(time.time())))
    conn.execute("INSERT INTO claims(invoice_id, token_hash, claimed_at) VALUES (?, ?, ?)", (body.invoiceId, token_hash, int(time.time())))
    conn.commit()

    return {"token": token, "credits": credits}
  finally:
    conn.close()

@app.get("/pro/status")
async def pro_status(request: Request):
  token = (request.headers.get("x-void-pro-token") or "").strip()
  if not token:
    return {"status": "off", "credits_left": 0}

  th = _hash_token(token)
  conn = get_db()
  try:
    row = conn.execute("SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)).fetchone()
    if not row:
      # Return 401 so frontend knows to unlink
      raise HTTPException(status_code=401, detail="Invalid token")

    left = row["credits_left"]
    status = "active" if left > 0 else "exhausted"
    return {"status": status, "credits_left": left}
  finally:
    conn.close()

# --- ROUTES: CHAT ---
@app.post("/chat/stream")
async def chat_stream(request: Request, body: ChatIn):
  headers = await _enforce_limits(request)

  payload = {
    "model": OLLAMA_MODEL,
    "messages": _build_msgs(body),
    "stream": True,
    "keep_alive": "5m",
  }

  async def gen() -> AsyncGenerator[bytes, None]:
    async with httpx.AsyncClient(timeout=None) as client:
      async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/chat", json=payload) as r:
        r.raise_for_status()
        async for line in r.aiter_lines():
          if await request.is_disconnected():
            break
          if not line:
            continue
          try:
            obj = json.loads(line)
            chunk = (obj.get("message") or {}).get("content") or ""
            if chunk:
              yield chunk.encode("utf-8")
            if obj.get("done") is True:
              break
          except json.JSONDecodeError:
            continue

  return StreamingResponse(gen(), media_type="text/plain; charset=utf-8", headers=headers)

@app.post("/dev/reset-free")
async def dev_reset_free(request: Request):
  if not DEV_RESET_ENABLED:
    raise HTTPException(status_code=404, detail="Not found")
  if redis is None:
    raise HTTPException(status_code=503, detail="Redis not configured")

  ipkey = _ip_bucket(request)
  free_key = f"free:{ipkey}"
  await redis.set(free_key, FREE_LIMIT, ex=FREE_TTL_SECONDS)
  return {"free_left": FREE_LIMIT}