"""Configuration endpoint — tells the frontend what features are enabled."""

from fastapi import APIRouter

from config.settings import settings

router = APIRouter()


@router.get("/config")
async def get_config():
    """Return server configuration so the frontend can adjust its UI."""
    nowpayments_configured = (
        settings.payments_enabled
        and settings.payment_gateway == "nowpayments"
        and bool(settings.nowpayments_api_key)
    )
    btcpay_configured = (
        settings.payments_enabled
        and settings.payment_gateway == "btcpay"
        and bool(settings.btcpay_store_id)
    )
    gateway = ""
    if nowpayments_configured:
        gateway = "nowpayments"
    elif btcpay_configured:
        gateway = "btcpay"

    return {
        "payments_enabled": settings.payments_enabled,
        "payment_gateway": gateway,
        "gateway_configured": bool(gateway),
        "ai_base_url": settings.ollama_base_url,
        "can_override_ai_url": not settings.payments_enabled,
        "plans": settings.plans if settings.payments_enabled else [],
    }


@router.post("/configure/ai-url")
async def set_ai_base_url(data: dict):
    """Override the AI backend URL at runtime (self-hosted mode only)."""
    if settings.payments_enabled:
        return {"error": "AI URL is managed via .env in payment mode"}
    url = data.get("url", "").strip()
    if not url.startswith(("http://", "https://")):
        return {"error": "URL must start with http:// or https://"}
    settings.set_ollama_base_url(url)
    return {"ok": True, "ai_base_url": settings.ollama_base_url}
