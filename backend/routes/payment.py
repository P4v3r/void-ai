"""Payment routes — NOWPayments gateway and BTCPay fallback."""

import hashlib
import hmac
import json
import time
import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request

from config.settings import settings

router = APIRouter()

# Crypto code → currency name mapping
CURRENCY_MAP = {
    "btc": "bitcoin",
    "xmr": "monero",
}


def _verify_nowpayments_sig(body: bytes, signature: str) -> bool:
    """Verify NOWPayments IPN webhook signature (HMAC-SHA512)."""
    msg = json.dumps(json.loads(body.decode()), sort_keys=True, separators=(",", ":"))
    expected = hmac.new(
        settings.nowpayments_ipn_secret.encode(),
        msg.encode(),
        hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.get("/get-prices")
async def get_prices():
    """Return estimated BTC and XMR amounts for $10 USD."""
    if settings.payment_gateway == "nowpayments" and settings.nowpayments_api_key:
        try:
            btc_est = await _nowpayments_estimate(10, "btc")
            xmr_est = await _nowpayments_estimate(10, "xmr")
            return {
                "btc_usd": round(10 / btc_est, 2) if btc_est > 0 else 0,
                "xmr_usd": round(10 / xmr_est, 2) if xmr_est > 0 else 0,
            }
        except Exception as e:
            print(f"Error fetching NOWPayments estimates: {e}")
    # Fallback: return zeros so frontend shows "Unable to fetch prices"
    return {"btc_usd": 0, "xmr_usd": 0}


async def _nowpayments_estimate(usd_amount: float, currency: str) -> float:
    """Get estimated crypto amount for USD price."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.nowpayments.io/v1/estimate",
            headers={"x-api-key": settings.nowpayments_api_key},
            params={
                "price_amount": usd_amount,
                "price_currency": "usd",
                "pay_currency": currency,
            },
        )
        resp.raise_for_status()
        return float(resp.json().get("estimated_amount", 0))


@router.post("/create-payment")
async def create_payment(body: dict):
    """Create a payment via the configured gateway.

    Expected body:
    - plan_id: str (e.g., "starter", "plus", "max")
    - pay_currency: str ("btc" or "xmr")
    - ipn_callback_url: str (optional, for webhook callbacks)

    Returns:
    - payment_id, pay_address, pay_amount, pay_currency, payment_url, order_id
    """
    if not settings.payments_enabled:
        raise HTTPException(status_code=404, detail="Payments not enabled")

    plan_id = body.get("plan_id", "").strip()
    pay_currency = body.get("pay_currency", "btc").lower()
    ipn_callback = body.get("ipn_callback_url", "")

    if plan_id not in [p["id"] for p in settings.plans]:
        raise HTTPException(status_code=400, detail="Unknown plan")

    # Get plan details from server config
    plan = next(p for p in settings.plans if p["id"] == plan_id)
    price_usd = plan["price_usd"]
    credits = plan["credits"]

    # Generate a unique order ID (used to link payment to this purchase)
    order_id = f"void_{plan_id}_{int(time.time())}_{secrets.token_hex(4)}"

    if settings.payment_gateway == "nowpayments" and settings.nowpayments_api_key:
        return await _create_nowpayments_payment(
            price_usd=price_usd,
            pay_currency=pay_currency,
            order_id=order_id,
            order_description=f"VOID AI {plan['title']} plan — {credits} credits",
            ipn_callback_url=ipn_callback,
        )

    elif settings.payment_gateway == "btcpay" and settings.btcpay_store_id:
        return await _create_btcpay_invoice(
            amount=price_usd,
            currency="USD",
            order_id=order_id,
        )

    raise HTTPException(status_code=500, detail="No payment gateway configured")


async def _create_nowpayments_payment(
    price_usd: float,
    pay_currency: str,
    order_id: str,
    order_description: str,
    ipn_callback_url: str,
) -> dict:
    """Create payment via NOWPayments."""
    from services.nowpayments import create_payment

    try:
        result = await create_payment(
            price_amount=price_usd,
            price_currency="usd",
            pay_currency=pay_currency,
            order_id=order_id,
            order_description=order_description,
            ipn_callback_url=ipn_callback_url,
        )
    except httpx.HTTPStatusError as e:
        error_body = e.response.text[:500]
        print(f"[NOWPayments] HTTP {e.response.status_code} on order_id={order_id}: {error_body}")
        raise HTTPException(
            status_code=502,
            detail=f"Payment gateway error {e.response.status_code}: {error_body}",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {e}")

    return {
        "gateway": "nowpayments",
        "payment_id": result.get("payment_id"),
        "pay_address": result.get("pay_address"),
        "pay_amount": result.get("pay_amount"),
        "pay_currency": result.get("pay_currency"),
        "payment_url": result.get("payment_url", ""),
        "order_id": order_id,
        "payment_status": result.get("payment_status", "waiting"),
    }


async def _create_btcpay_invoice(
    amount: float,
    currency: str,
    order_id: str,
) -> dict:
    """Create invoice via BTCPay Server."""
    url = f"{settings.btcpay_url}/api/v1/stores/{settings.btcpay_store_id}/invoices"
    payload = {
        "amount": amount,
        "currency": currency,
        "metadata": {"orderId": order_id},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"token {settings.btcpay_api_key}",
            },
            json=payload,
        )

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"BTCPay error: {resp.status_code}",
        )

    data = resp.json()
    invoice_id = data.get("id")
    checkout = data.get("checkoutLink") or (
        f"{settings.btcpay_url}/i/{invoice_id}" if invoice_id else ""
    )

    return {
        "gateway": "btcpay",
        "payment_id": invoice_id,
        "pay_address": "",
        "pay_amount": amount,
        "pay_currency": currency,
        "payment_url": checkout,
        "order_id": order_id,
        "payment_status": "new",
    }


@router.post("/nowpayments-webhook")
async def nowpayments_webhook(request: Request):
    """Handle NOWPayments IPN webhook callbacks.

    When a payment status changes to "finished", creates a pro token
    and stores it in the database.
    """
    if not settings.nowpayments_ipn_secret:
        raise HTTPException(status_code=500, detail="IPN secret not configured")

    raw = await request.body()
    sig = request.headers.get("x-nowpayments-sig", "")

    if not _verify_nowpayments_sig(raw, sig):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return {"ok": True}

    status = event.get("payment_status", "")
    if status != "finished":
        return {"ok": True}

    # Extract credits from the order description: "VOID AI Starter plan — 500 credits"
    order_desc = event.get("order_description", "")
    credits = _extract_credits_from_description(order_desc)
    if credits <= 0:
        print(f"Webhook: could not extract credits from description: {order_desc}")
        return {"ok": True}

    order_id = event.get("order_id", "")
    payment_id = event.get("payment_id")
    pay_amount = event.get("pay_amount", 0)
    pay_currency = event.get("pay_currency", "")

    print(
        f"Payment confirmed: {order_id} — {pay_amount} {pay_currency} "
        f"(payment_id={payment_id}, credits={credits})"
    )

    # Generate pro token
    token = "void_" + secrets.token_urlsafe(32)
    from utils.crypto_utils import hash_token

    token_hash = hash_token(token)

    # Store in database
    from db.sqlite import get_db

    conn = get_db()
    try:
        # Check if this payment was already claimed
        existing = conn.execute(
            "SELECT token_hash FROM invoices WHERE order_id = ?", (order_id,)
        ).fetchone()
        if existing:
            # Already claimed, return the existing token
            row = conn.execute(
                "SELECT token_hash FROM invoices WHERE order_id = ?", (order_id,)
            ).fetchone()
            return {"ok": True, "token": None}  # Token already stored

        conn.execute(
            "INSERT INTO invoices(invoice_id, credits, status, created_at, order_id) "
            "VALUES (?, ?, 'paid', ?, ?)",
            (str(payment_id), credits, int(time.time()), order_id),
        )
        conn.execute(
            "INSERT INTO pro_tokens(token_hash, credits_left, created_at) "
            "VALUES (?, ?, ?)",
            (token_hash, credits, int(time.time())),
        )
        conn.commit()

        # Store token temporarily in Redis so the frontend can claim it via polling
        from state.redis_state import get_redis

        redis = get_redis()
        if redis:
            await redis.set(
                f"void:payment_token:{order_id}",
                token,
                ex=3600,  # Token available for 1h
            )

    finally:
        conn.close()

    return {"ok": True, "order_id": order_id}


def _extract_credits_from_description(description: str) -> int:
    """Extract credits count from order description.

    Format: "VOID AI Starter plan — 500 credits"
    """
    try:
        # Find the number before "credits"
        parts = description.split("credits")[0].strip().split()
        return int(parts[-1])
    except Exception:
        return 0
