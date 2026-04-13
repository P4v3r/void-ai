"""Request helper utilities."""

from typing import List

from fastapi import Request

from models.pydantic import ChatIn


def get_raw_ip(request: Request) -> str:
    """Extract the raw client IP from the request.

    Checks Cloudflare header, X-Forwarded-For, then falls back to client.host.
    The raw IP is immediately hashed elsewhere — never stored.
    """
    return (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def build_messages(body: ChatIn) -> List[dict]:
    """Build a list of message dicts from the request body.

    If `messages` is provided, use those. Otherwise wrap `message` as a single user message.
    """
    if body.messages and len(body.messages) > 0:
        return [m.model_dump() for m in body.messages]
    return [{"role": "user", "content": body.message or ""}]
