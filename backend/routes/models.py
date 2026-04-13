"""Models route — lists available Ollama models."""

from fastapi import APIRouter

from services.ollama import fetch_ollama_models

router = APIRouter()


@router.get("")
async def get_models():
    """Return available models from the Ollama instance."""
    return await fetch_ollama_models()
