"""Global Redis connection state.

This module holds the application-level Redis connection that is
set up during startup and shared across middleware and routes.
"""

from typing import Optional
from redis.asyncio import Redis

redis_connection: Optional[Redis] = None


def get_redis() -> Optional[Redis]:
    """Return the global Redis connection, or None if not connected."""
    return redis_connection


def set_redis(conn: Optional[Redis]) -> None:
    """Set the global Redis connection."""
    global redis_connection
    redis_connection = conn
