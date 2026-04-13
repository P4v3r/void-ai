"""Dev/admin routes — for development and testing only.

These routes are only mounted when PAYMENTS_ENABLED=1,
so all handlers assume authentication and Redis are active.
"""

from fastapi import APIRouter, Request, HTTPException

from config.settings import settings
from db.sqlite import get_db
from state.redis_state import get_redis

router = APIRouter()


@router.post("/reset-free")
async def dev_reset_free(request: Request):
    """Reset free credits for a client. Only works when DEV_RESET_ENABLED=1."""
    if not settings.dev_reset_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    redis = get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="Redis not configured")

    client_id = request.headers.get("x-void-client-id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Missing Client ID")

    redis_key = f"free:{client_id}"
    await redis.set(redis_key, settings.free_limit, ex=settings.free_ttl_seconds)

    conn = get_db()
    try:
        conn.execute(
            "UPDATE free_usage SET last_reset = 0 WHERE client_id = ?", (client_id,)
        )
        conn.commit()
    finally:
        conn.close()

    return {"free_left": settings.free_limit}
