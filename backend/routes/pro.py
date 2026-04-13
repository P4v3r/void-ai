"""Pro token routes — status check and payment polling."""

from fastapi import APIRouter, Request, HTTPException

from config.settings import settings
from utils.crypto_utils import hash_token


router = APIRouter()


@router.get("/status")
async def pro_status(request: Request):
    """Check the status of a pro token."""
    token = (request.headers.get("x-void-pro-token") or "").strip()
    if not token:
        return {"status": "off", "credits_left": 0}

    th = hash_token(token)
    from db.sqlite import get_db

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid token")
        left = row["credits_left"]
        status = "active" if left > 0 else "exhausted"
        return {"status": status, "credits_left": left}
    finally:
        conn.close()


@router.get("/pending-payment/{order_id}")
async def get_pending_payment(order_id: str):
    """Check if a payment has been completed and return the token.

    Used by the frontend to poll for payment completion after the
    user has sent crypto. The token is stored in Redis by the webhook
    handler when NOWPayments confirms the payment.
    """
    from state.redis_state import get_redis

    redis = get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis not available")

    token = await redis.get(f"void:payment_token:{order_id}")
    if not token:
        # Check if payment exists in DB but wasn't stored in Redis
        from db.sqlite import get_db

        conn = get_db()
        try:
            row = conn.execute(
                "SELECT invoice_id, credits FROM invoices WHERE order_id = ? AND status = 'paid'",
                (order_id,),
            ).fetchone()
            if row:
                # Payment confirmed but token already stored elsewhere
                return {"status": "completed", "token": None}
            return {"status": "waiting"}
        finally:
            conn.close()
        return

    return {"status": "completed", "token": token.decode() if isinstance(token, bytes) else token}
