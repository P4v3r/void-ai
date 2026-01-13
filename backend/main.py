import os
import json
import time
import hashlib
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

# --- CONFIGURAZIONE WALLETS STATICHE ---
# Puoi metterle nel file .env o qui (Meglio in .env)
WALLET_BTC = os.getenv("WALLET_BTC", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")
WALLET_XMR = os.getenv("WALLET_XMR", "44Affq6kbKs4YmM2aVZGQV3wXJvP8kR8p9")

# ... resto del codice ...

# --- CONFIGURATION ---
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "dolphin-mistral:latest")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# --- SECURITY & ANONYMITY SETTINGS ---
# Genera o usa un segreto fisso per firmare gli hash. 
# Questo rende il database inutile se rubato (Privacy by Design).
SERVER_SALT = os.getenv("SERVER_SALT", "change_this_to_a_random_string_in_production")

# Limit Settings
FREE_LIMIT = int(os.getenv("FREE_LIMIT", "50")) 
FREE_TTL_SECONDS = int(os.getenv("FREE_TTL_SECONDS", str(24 * 60 * 60))) # 24 Ore

# Rate Limiting (Anti-DDoS, basato su IP grezzo ma hashato per protezione)
RL_WINDOW_SECONDS = int(os.getenv("RL_WINDOW_SECONDS", "60"))
RL_MAX_REQUESTS_IP = int(os.getenv("RL_MAX_REQUESTS_IP", "30")) 

DEV_RESET_ENABLED = os.getenv("DEV_RESET_ENABLED", "0") == "1"

# BTCPay Settings
BTCPAY_URL = os.getenv("BTCPAY_URL", "https://testnet.demo.btcpayserver.org")
BTCPAY_STORE_ID = os.getenv("BTCPAY_STORE_ID", "")
BTCPAY_API_KEY = os.getenv("BTCPAY_API_KEY", "")
BTCPAY_WEBHOOK_SECRET = os.getenv("BTCPAY_WEBHOOK_SECRET", "")

DB_PATH = os.getenv("DB_PATH", "void.db")

redis: Optional[Redis] = None

# --- MIDDLEWARE ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
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

class ManualClaimIn(BaseModel):
    planId: str
    credits: int
    amount: float # Prezzo in USD

# --- DATABASE HELPERS ---
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # Tabella Token Pro
    c.execute("""
        CREATE TABLE IF NOT EXISTS pro_tokens (
            token_hash TEXT PRIMARY KEY,
            credits_left INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)
    
    # Tabella Fatture
    c.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            invoice_id TEXT PRIMARY KEY,
            credits INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL
        )
    """)
    
    # Tabella Claims
    c.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            invoice_id TEXT PRIMARY KEY,
            token_hash TEXT,
            claimed_at INTEGER NOT NULL
        )
    """)

    # NUOVA Tabella Free Usage (Massima Sicurezza & Privacy)
    # client_id: ID pubblico che l'utente vede.
    # fp_hash: HMAC(Salt + BrowserFingerprint). Identità univoca del dispositivo.
    # ip_hash: HMAC(Salt + IP). Identità della rete.
    c.execute("""
        CREATE TABLE IF NOT EXISTS free_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT UNIQUE,
            fp_hash TEXT UNIQUE,    -- Vincolante: Identità Hardware
            ip_hash TEXT,           -- Variabile: Identità Rete
            last_reset INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)
    
    # Indici per lookup veloce
    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_client ON free_usage(client_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_fp ON free_usage(fp_hash)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ip ON free_usage(ip_hash)")
    except:
        pass
    
    conn.commit()
    conn.close()

# --- UTILS ---
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _secure_hash(data: str) -> str:
    """
    Crea un hash HMAC sicuro. 
    Usa SERVER_SALT per rendere l'hash irriveribile senza la chiave del server.
    """
    return hmac.new(SERVER_SALT.encode(), data.encode(), hashlib.sha256).hexdigest()

def _verify_btcpay_sig(raw_body: bytes, btcpay_sig: str, secret: str) -> bool:
    if not btcpay_sig or not btcpay_sig.startswith("sha256="):
        return False
    their = btcpay_sig.split("=", 1)[1].strip()
    mac = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, their)

def _get_raw_ip(request: Request) -> str:
    # Ottiene l'IP grezzo solo per hasharlo subito dopo
    return (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )

def _build_msgs(body: ChatIn) -> List[dict]:
    if body.messages and len(body.messages) > 0:
        return [m.model_dump() for m in body.messages]
    return [{"role": "user", "content": body.message or ""}]

# --- LUA SCRIPTS ---
FREE_LUA = """
local v = redis.call('GET', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])

if not v then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return ARGV[1] - 1
end

local n = tonumber(v)
if n <= 0 then
  if ttl < 0 then 
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
     return ARGV[1] - 1
  end
  return -1
end
return redis.call('DECR', KEYS[1])
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

# --- ROUTE: MODELS ---
@app.get("/models")
async def get_models():
    try:
        # Chiamiamo Ollama per sapere quali modelli sono stati scaricati (tags)
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            res.raise_for_status()
            data = res.json()
            # Estraiamo solo i nomi
            models = [m['name'] for m in data.get('models', [])]
            return {"models": models, "default": OLLAMA_MODEL}
    except Exception as e:
        # Se Ollama è spento o errore, restituiamo almeno quello configurato
        print(f"Errore caricamento modelli: {e}")
        return {"models": [OLLAMA_MODEL], "default": OLLAMA_MODEL}

# --- LOGIC: LIMITS & AUTH ---

async def _enforce_limits(request: Request) -> Dict[str, str]:
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis not configured")

    # 1. Input & Hashing (Privacy)
    client_id = request.headers.get("x-void-client-id", "").strip()
    raw_fp = request.headers.get("x-void-browser-fp", "").strip()
    raw_ip = _get_raw_ip(request)

    # Validazione base
    if not client_id or len(client_id) < 10:
        raise HTTPException(status_code=400, detail="Invalid Client ID.")
    if not raw_fp or len(raw_fp) < 10:
        raise HTTPException(status_code=400, detail="Missing Browser Fingerprint.")

    # Secure Hashing (Non salviamo mai i dati grezzi)
    fp_hash = _secure_hash(raw_fp)
    ip_hash = _secure_hash(raw_ip)

    # 2. Rate Limiting (Protezione Server DDoS)
    window_id = int(time.time() // RL_WINDOW_SECONDS)
    rl_key = f"rl:{ip_hash}:{window_id}"
    
    rem_ip, ttl_ip = await redis.eval(RL_LUA, 1, rl_key, RL_MAX_REQUESTS_IP, RL_WINDOW_SECONDS)
    if isinstance(rem_ip, list): rem_ip, ttl_ip = int(rem_ip[0]), int(rem_ip[1])
    else: rem_ip, ttl_ip = int(rem_ip), int(RL_WINDOW_SECONDS)

    headers = {
        "X-RateLimit-Limit": str(RL_MAX_REQUESTS_IP),
        "X-RateLimit-Remaining": str(max(rem_ip, 0)),
    }

    if rem_ip < 0:
        headers["Retry-After"] = str(ttl_ip)
        raise HTTPException(status_code=429, detail="Too many requests from this IP.", headers=headers)

    # 3. Controllo PRO TOKEN (Bypass limits)
    pro_token = request.headers.get("x-void-pro-token", "").strip()
    if pro_token:
        th = _hash_token(pro_token)
        conn = get_db()
        try:
            row = conn.execute("SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)).fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="Invalid Pro Token", headers=headers)
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

    # 4. LOGICA CREDITI FREE (SMART BINDING)
    # Strategia: Cerca prima per FP (Hardware). Se non trovi, cerca per IP (Rete).
    
    conn = get_db()
    try:
        row = conn.execute("SELECT client_id, fp_hash, ip_hash, last_reset FROM free_usage WHERE client_id = ?", (client_id,)).fetchone()
        effective_id = client_id
        
        # CASO 1: User ID sconosciuto (Nuovo browser o Incognito)
        if not row:
            # Tentativo 1: Cerca per Fingerprint (L'utente è in Incognito sullo stesso dispositivo?)
            row_fp = conn.execute("SELECT client_id, ip_hash, last_reset FROM free_usage WHERE fp_hash = ?", (fp_hash,)).fetchone()
            
            if row_fp:
                # TROVATO TRAMITE FP: È l'utente che prova a fregare in Incognito.
                # Associamo il nuovo Client ID al vecchio account fisico.
                effective_id = row_fp["client_id"]
                # Aggiorniamo il DB per ottimizzare le richieste future
                conn.execute("UPDATE free_usage SET client_id = ?, ip_hash = ? WHERE fp_hash = ?", (client_id, ip_hash, fp_hash))
                conn.commit()
                row = row_fp # Usiamo i dati vecchi (probabilmente crediti finiti)
            else:
                # Tentativo 2: Cerca per IP (L'utente ha cambiato browser o reinstallato?)
                # Questo aiuta a non perdere i crediti se l'FP cambia leggermente o il browser viene pulito,
                # purché resti sulla stessa rete.
                row_ip = conn.execute("SELECT client_id, last_reset FROM free_usage WHERE ip_hash = ?", (ip_hash,)).fetchone()
                
                if row_ip:
                    # TROVATO TRAMITE IP: L'utente è sulla stessa rete ma browser nuovo.
                    # Bindiamo il nuovo FP e ID all'account esistente.
                    effective_id = row_ip["client_id"]
                    conn.execute("UPDATE free_usage SET client_id = ?, fp_hash = ? WHERE ip_hash = ?", (client_id, fp_hash, ip_hash))
                    conn.commit()
                    row = row_ip
                else:
                    # UTENTE COMPLETAMENTE NUOVO
                    now = int(time.time())
                    conn.execute("INSERT INTO free_usage (client_id, fp_hash, ip_hash, last_reset, created_at) VALUES (?, ?, ?, ?, ?)", 
                                 (client_id, fp_hash, ip_hash, now, now))
                    conn.commit()
                    # row resta None -> Verrà trattato come nuovo

        # Gestione Redis e Reset
        redis_key = f"free:{effective_id}"
        
        # Tenta decremento Redis
        remaining = await redis.eval(FREE_LUA, 1, redis_key, FREE_LIMIT, FREE_TTL_SECONDS)
        remaining = int(remaining)

        # Se Redis dice limit reached, controlliamo SQLite per reset orario
        if remaining < 0:
            now = int(time.time())
            should_reset = False
            
            if row:
                if now - row["last_reset"] > FREE_TTL_SECONDS:
                    should_reset = True
                    # Aggiorniamo anche IP se è cambiato nel frattempo (utente si è spostato)
                    conn.execute("UPDATE free_usage SET last_reset = ?, ip_hash = ? WHERE client_id = ?", (now, ip_hash, effective_id))
                    conn.commit()
            else:
                should_reset = True

            if should_reset:
                remaining = await redis.eval(FREE_LUA, 1, redis_key, FREE_LIMIT, FREE_TTL_SECONDS)
                remaining = int(remaining)
            else:
                remaining = -1

        headers["X-Free-Left"] = str(max(remaining, 0))
        if remaining < 0:
            raise HTTPException(status_code=402, detail="Free limit reached. Wait 24h or buy Pro.", headers=headers)

        return headers

    finally:
        conn.close()

# --- ROUTES: PAYMENT ---
@app.post("/pro/create-invoice")
async def pro_create_invoice(body: ProInvoiceIn):
    if not BTCPAY_STORE_ID or not BTCPAY_API_KEY:
        raise HTTPException(status_code=500, detail="Payment not configured")

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
        raise HTTPException(status_code=502, detail=f"Payment provider error {r.status_code}")

    data = r.json()
    invoice_id = data.get("id")
    checkout = data.get("checkoutLink") or (f"{BTCPAY_URL}/i/{invoice_id}" if invoice_id else None)

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
        return {"ok": True}

    invoice_id = event.get("invoiceId") or event.get("id")
    event_type = (event.get("type") or "").lower()

    if not invoice_id:
        return {"ok": True}

    if "confirmed" in event_type or "paid" in event_type or "complete" in event_type:
        conn = get_db()
        try:
            inv = conn.execute("SELECT status FROM invoices WHERE invoice_id = ?", (invoice_id,)).fetchone()
            if inv and inv["status"] == "pending":
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

        claimed = conn.execute("SELECT token_hash FROM claims WHERE invoice_id = ?", (body.invoiceId,)).fetchone()
        if claimed:
            raise HTTPException(status_code=409, detail="Token already claimed")

        token = "void_" + secrets.token_urlsafe(32)
        token_hash = _hash_token(token)
        credits = inv["credits"]

        conn.execute("INSERT INTO pro_tokens(token_hash, credits_left, created_at) VALUES (?, ?, ?)", (token_hash, credits, int(time.time())))
        conn.execute("INSERT INTO claims(invoice_id, token_hash, claimed_at) VALUES (?, ?, ?)", (body.invoiceId, token_hash, int(time.time())))

        # Cancella la fattura dal DB (Log minimization)
        conn.execute("DELETE FROM invoices WHERE invoice_id = ?", (body.invoiceId,))
        
        conn.commit()
        return {"token": token, "credits": credits}
    finally:
        conn.close()


# --- HELPER: Prezzi Crypto ---
async def get_crypto_price(coin_id: str) -> float:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # CoinGecko API (Gratuito)
            url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd"
            r = await client.get(url)
            data = r.json()
            return float(data[coin_id]['usd'])
    except Exception as e:
        print(f"Error fetching price for {coin_id}: {e}")
        # Se fallisce il prezzo, ritorniamo 1 per evitare divisioni per zero, 
        # ma il controllo fallirà se il pagamento non è stato fatto.
        return 1.0

# --- HELPER: Saldo BTC (Blockchain API) ---
async def get_btc_balance(address: str) -> float:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Blockchain.info restituisce il saldo in Satoshis
            url = f"https://blockchain.info/balance/{address}?confirmations=1"
            r = await client.get(url)
            data = r.json()
            # Converte Satoshis in BTC
            return float(data.get('final_balance', 0)) / 100_000_000
    except Exception as e:
        print(f"Error fetching BTC balance: {e}")
        return 0.0

# --- HELPER: Saldo XMR (Blockchair API) ---
async def get_xmr_balance(address: str) -> float:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Blockchair restituisce il saldo in atomic units
            url = f"https://api.blockchair.com/xmr/dashboards/address/{address}"
            r = await client.get(url)
            data = r.json()
            # Converte atomic units in XMR
            return float(data.get(address, {}).get('address', {}).get('balance', 0)) / 1_000_000_000_000
    except Exception as e:
        print(f"Error fetching XMR balance: {e}")
        return 0.0

# --- ENDPOINT: MANUAL CLAIM ---
@app.post("/pro/manual-claim")
async def pro_manual_claim(body: ManualClaimIn):
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis not configured")

    # Recupera i prezzi attuali
    price_btc, price_xmr = await asyncio.gather(
        get_crypto_price("bitcoin"),
        get_crypto_price("monero")
    )

    # Recupera i saldi attuali
    curr_btc, curr_xmr = await asyncio.gather(
        get_btc_balance(WALLET_BTC),
        get_xmr_balance(WALLET_XMR)
    )

    # Recupera i saldi precedenti da Redis (per rilevare transazioni nuove)
    old_btc = float(await redis.get("manual_balance:btc") or 0)
    old_xmr = float(await redis.get("manual_balance:xmr") or 0)

    # Calcola quanto è arrivato di NUOVO
    new_btc = curr_btc - old_btc
    new_xmr = curr_xmr - old_xmr

    # Calcola quanto vale la transazione in USD
    value_usd_btc = new_btc * price_btc
    value_usd_xmr = new_xmr * price_xmr

    # Tolleranza (perché i prezzi cambiano e le API possono essere ritardate)
    # Accettiamo se il valore è almeno il 90% del piano
    target_amount = body.amount
    tolerance = target_amount * 0.90

    payment_found = False

    # Verifica BTC
    if value_usd_btc >= tolerance:
        print(f"Payment found: {new_btc} BTC (USD: {value_usd_btc:.2f})")
        payment_found = True
        await redis.set("manual_balance:btc", str(curr_btc))

    # Verifica XMR
    elif value_usd_xmr >= tolerance:
        print(f"Payment found: {new_xmr} XMR (USD: {value_usd_xmr:.2f})")
        payment_found = True
        await redis.set("manual_balance:xmr", str(curr_xmr))

    # Se non c'è pagamento
    if not payment_found:
        return {"status": "error", "detail": "No new payment detected or amount too low."}

    # SE C'È PAGAMENTO: Genera Token
    token = "void_" + secrets.token_urlsafe(32)
    token_hash = _hash_token(token)

    conn = get_db()
    try:
        conn.execute("INSERT INTO pro_tokens(token_hash, credits_left, created_at) VALUES (?, ?, ?)", 
                     (token_hash, body.credits, int(time.time())))
        conn.commit()
    finally:
        conn.close()

    return {"status": "success", "token": token, "credits": body.credits}

# --- ENDPOINT PREZZI LIVE ---
@app.get("/pro/get-prices")
async def get_prices():
    try:
        price_btc, price_xmr = await asyncio.gather(
            get_crypto_price("bitcoin"),
            get_crypto_price("monero")
        )
        return {
            "btc_usd": price_btc,
            "xmr_usd": price_xmr
        }
    except Exception as e:
        # Fallback prezzi se API down
        return {"btc_usd": 65000, "xmr_usd": 150}

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

    client_id = request.headers.get("x-void-client-id")
    if not client_id:
         raise HTTPException(status_code=400, detail="Missing Client ID")

    redis_key = f"free:{client_id}"
    await redis.set(redis_key, FREE_LIMIT, ex=FREE_TTL_SECONDS)
    
    conn = get_db()
    try:
        conn.execute("UPDATE free_usage SET last_reset = 0 WHERE client_id = ?", (client_id,))
        conn.commit()
    finally:
        conn.close()

    return {"free_left": FREE_LIMIT}