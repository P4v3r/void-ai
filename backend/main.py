from fastapi import FastAPI
from fastapi import Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Literal, Optional
from fastapi.responses import StreamingResponse
import json
import os
import httpx

app = FastAPI()

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "dolphin-mistral")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatIn(BaseModel):
    message: str

class ChatMsg(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatIn(BaseModel):
    # nuovo: inviamo tutta la chat
    messages: Optional[List[ChatMsg]] = None
    # vecchio: lo teniamo per compatibilità
    message: Optional[str] = None

@app.post("/chat")
async def chat(body: ChatIn):
    # se arriva la history, usa quella; altrimenti usa il singolo messaggio
    if body.messages and len(body.messages) > 0:
        msgs = [m.model_dump() for m in body.messages]
    else:
        msgs = [{"role": "user", "content": body.message or ""}]

    payload = {
        "model": OLLAMA_MODEL,
        "messages": msgs,
        "stream": False,
        # opzionale: tieni il modello “carico” un po’ per ridurre lentezza tra messaggi
        # (default di Ollama è un keep-alive, e puoi anche impostarlo tu)
        "keep_alive": "5m",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()

    return {"text": data["message"]["content"]}

@app.post("/chat/stream")
async def chat_stream(request: Request, body: ChatIn):
    if body.messages and len(body.messages) > 0:
        msgs = [m.model_dump() for m in body.messages]
    else:
        msgs = [{"role": "user", "content": body.message or ""}]

    payload = {
        "model": OLLAMA_MODEL,
        "messages": msgs,
        "stream": True,
        "keep_alive": "5m",
    }

    async def gen():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/chat", json=payload) as r:
                r.raise_for_status()

                async for line in r.aiter_lines():
                    if await request.is_disconnected():
                        break  # client pressed Stop / closed tab [web:323][web:325]

                    if not line:
                        continue

                    obj = json.loads(line)
                    chunk = (obj.get("message") or {}).get("content") or ""
                    if chunk:
                        yield chunk

                    if obj.get("done") is True:
                        break

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")

    # usa la history se c'è, altrimenti usa message
    if body.messages and len(body.messages) > 0:
        msgs = [m.model_dump() for m in body.messages]
    else:
        msgs = [{"role": "user", "content": body.message or ""}]

    payload = {
        "model": OLLAMA_MODEL,
        "messages": msgs,
        "stream": True,         # streaming ON (default su endpoint che supportano streaming)
        "keep_alive": "5m",
    }

    async def gen():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/chat", json=payload) as r:
                r.raise_for_status()

                # Ollama manda righe JSON (NDJSON) durante lo streaming [web:313]
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    obj = json.loads(line)

                    # per /api/chat i chunk arrivano dentro obj["message"]["content"] [web:286]
                    chunk = (obj.get("message") or {}).get("content") or ""
                    if chunk:
                        yield chunk

                    if obj.get("done") is True:
                        break

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
