"""Authentication, rate limiting, and payment middleware."""

import hashlib
import time
from typing import Dict

from fastapi import HTTPException, Request

from config.settings import settings
from db.sqlite import get_db
from middleware.rate_limit import RL_LUA
from state.redis_state import get_redis
from utils.crypto_utils import hash_token
from utils.helpers import get_raw_ip


def _rotating_ip_hash(raw_ip: str, window_id: int) -> str:
    """HMAC-SHA256 with a per-window rotating salt.

    Even if SERVER_SALT is leaked later, old rate-limit keys cannot be
    brute-forced because each time window used a different derived salt.
    """
    # Derive a per-window salt: SHA256(SERVER_SALT || window_id)
    window_salt = hashlib.sha256(
        f"{settings.server_salt}:{window_id}".encode()
    ).hexdigest()
    return hashlib.sha256(
        f"{window_salt}:{raw_ip}".encode()
    ).hexdigest()


async def enforce_limits(request: Request) -> Dict[str, str]:
    """Enforce rate limits and payment credits.

    When PAYMENTS_ENABLED is False: returns empty headers dict (no auth required).
    When PAYMENTS_ENABLED is True: checks IP rate limits and pro tokens.

    Args:
        request: The incoming FastAPI request.

    Raises:
        HTTPException: 400 (invalid input), 401 (invalid token), 429 (rate limited),
                       402 (credits exhausted), 503 (Redis unavailable).

    Returns:
        Dict of response headers to include in the streaming response.
    """
    if not settings.payments_enabled:
        # No limits, no auth required — pass-through mode.
        return {}

    redis = get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis not configured")

    # 1. Input & Hashing (Privacy)
    client_id = request.headers.get("x-void-client-id", "").strip()
    raw_fp = request.headers.get("x-void-browser-fp", "").strip()
    raw_ip = get_raw_ip(request)

    # Input validation
    if not client_id or len(client_id) < 10:
        raise HTTPException(status_code=400, detail="Invalid Client ID.")
    if not raw_fp or len(raw_fp) < 10:
        raise HTTPException(status_code=400, detail="Missing Browser Fingerprint.")

    # 2. Rate Limiting (DDoS protection — IP-based only, rotating salt)
    window_id = int(time.time() // settings.rl_window_seconds)
    ip_hash = _rotating_ip_hash(raw_ip, window_id)
    rl_key = f"rl:{ip_hash}:{window_id}"

    rem_ip, ttl_ip = await redis.eval(
        RL_LUA, 1, rl_key, settings.rl_max_requests_ip, settings.rl_window_seconds
    )
    if isinstance(rem_ip, list):
        rem_ip, ttl_ip = int(rem_ip[0]), int(rem_ip[1])
    else:
        rem_ip, ttl_ip = int(rem_ip), int(settings.rl_window_seconds)

    headers: Dict[str, str] = {
        "X-RateLimit-Limit": str(settings.rl_max_requests_ip),
        "X-RateLimit-Remaining": str(max(rem_ip, 0)),
    }

    if rem_ip < 0:
        headers["Retry-After"] = str(ttl_ip)
        raise HTTPException(
            status_code=429,
            detail="Too many requests from this IP.",
            headers=headers,
        )

    # 3. PRO TOKEN check
    pro_token = request.headers.get("x-void-pro-token", "").strip()
    if pro_token:
        th = hash_token(pro_token)
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)
            ).fetchone()
            if not row:
                raise HTTPException(
                    status_code=401, detail="Invalid Pro Token", headers=headers
                )
            if int(row[0]) <= 0:
                headers["X-Pro-Left"] = "0"
                raise HTTPException(
                    status_code=402,
                    detail="Pro credits exhausted",
                    headers=headers,
                )

            conn.execute(
                "UPDATE pro_tokens SET credits_left = credits_left - 1 WHERE token_hash = ?",
                (th,),
            )
            conn.commit()
            row = conn.execute(
                "SELECT credits_left FROM pro_tokens WHERE token_hash = ?", (th,)
            ).fetchone()
            left = int(row[0])
            headers["X-Pro-Left"] = str(left)
            return headers
        finally:
            conn.close()

    # No pro token — user is in payment mode without credits.
    # Allow the request (user should be able to chat freely; credits tracked via pro token only).
    return headers
