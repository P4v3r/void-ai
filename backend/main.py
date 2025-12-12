from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import os
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatIn(BaseModel):
    message: str

@app.post("/chat")
async def chat(body: ChatIn):
    return {"text": f"Echo: {body.message}"}

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")

@app.post("/chat", operation_id="chat_post")
async def chat(body: ChatIn):
    # Se non hai messo le chiavi, fai fallback su Echo
    if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
        return {"text": f"Echo: {body.message}"}

    url = f"https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/runsync"

    payload = {
        "input": {
            "prompt": body.message
        }
    }

    headers = {
        "authorization": RUNPOD_API_KEY,
        "content-type": "application/json",
        "accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload, headers=headers)
        data = r.json()

    # Qui la forma esatta di "output" dipende dal worker/template che hai scelto.
    # Intanto stampiamo qualcosa di sensato senza spaccare tutto:
    if "output" in data:
        return {"text": str(data["output"])}

    return {"text": str(data)}
