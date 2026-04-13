"""VOID AI — FastAPI application entry point.

Self-hosted, privacy-first AI chat interface for Ollama.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from config.settings import settings
from db.sqlite import init_db
from middleware.cors import setup_cors
from state.redis_state import get_redis, set_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    # Startup
    init_db()
    try:
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        await redis.ping()
        set_redis(redis)
        print(f"Redis connected at {settings.redis_url}")
    except Exception as e:
        if settings.payments_enabled:
            print(f"WARNING: Redis connection failed: {e}")
            print("Payments are enabled but Redis is unavailable. "
                  "Rate limiting and credit tracking will not work.")
        else:
            print("Redis not available — running in self-hosted mode (no limits).")
    yield
    # Shutdown
    redis = get_redis()
    if redis is not None:
        await redis.close()
        set_redis(None)


app = FastAPI(
    title="VOID AI",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

setup_cors(app)

# --- Routes ---
from routes.chat import router as chat_router            # noqa: E402
from routes.models import router as models_router        # noqa: E402
from routes.config import router as config_router        # noqa: E402

app.include_router(chat_router)
app.include_router(models_router, prefix="/models")
app.include_router(config_router)

# Payment and pro routes are only mounted when payments are enabled.
# This keeps the API surface clean and prevents confusion.
if settings.payments_enabled:
    from routes.pro import router as pro_router              # noqa: E402
    from routes.payment import router as payment_router      # noqa: E402
    from routes.dev import router as dev_router              # noqa: E402
    app.include_router(pro_router, prefix="/pro")
    app.include_router(payment_router)
    app.include_router(dev_router)
