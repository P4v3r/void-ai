"""Chat routes — streaming chat completions via Ollama."""

from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from config.settings import settings
from middleware.auth import enforce_limits
from models.pydantic import ChatIn
from services.ollama import stream_ollama_chat
from utils.helpers import build_messages

router = APIRouter()


@router.post("/chat/stream")
async def chat_stream(
    request: Request,
    body: ChatIn,
    headers: dict = Depends(enforce_limits),
):
    """Stream a chat completion from Ollama.

    When payments are enabled, requires auth headers and checks rate limits/credits.
    When disabled, works without any authentication.

    Accepts an optional `model` field in the request body to override the default model.
    """
    model = body.model or settings.ollama_model

    payload = {
        "model": model,
        "messages": build_messages(body),
        "stream": True,
        "keep_alive": "5m",
    }

    async def gen() -> AsyncGenerator[bytes, None]:
        async for chunk in stream_ollama_chat(payload, request.is_disconnected):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/plain; charset=utf-8",
        headers=headers,
    )
