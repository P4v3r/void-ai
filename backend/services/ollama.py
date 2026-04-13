"""Ollama service — model listing and chat streaming."""

import json
import httpx

from config.settings import settings


async def fetch_ollama_models() -> dict:
    """Fetch available models from the Ollama API.

    Returns a dict with 'models' (list of names) and 'default' (configured model).
    Falls back to the configured default model if Ollama is unreachable.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{settings.ollama_base_url}/api/tags")
            res.raise_for_status()
            data = res.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models, "default": settings.ollama_model}
    except Exception as e:
        print(f"Error loading models from Ollama: {e}")
        return {"models": [], "default": ""}


async def stream_ollama_chat(payload: dict, is_disconnected):
    """Stream a chat completion from Ollama.

    Yields text chunks as raw bytes. Stops if the client disconnects.
    """
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST", f"{settings.ollama_base_url}/api/chat", json=payload
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if await is_disconnected():
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
