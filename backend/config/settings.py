"""Application configuration and settings.

All environment variables and their defaults are defined here.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    # Ollama — loaded from env at startup, overridable at runtime via POST /configure/ai-url
    _ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "")

    @property
    def ollama_base_url(self) -> str:
        return self._ollama_base_url

    def set_ollama_base_url(self, url: str) -> None:
        """Override Ollama URL at runtime (self-hosted mode only)."""
        url = url.strip()
        if url.startswith("http://") or url.startswith("https://"):
            self._ollama_base_url = url

    # Security — HMAC salt for fingerprint hashing
    server_salt: str = os.getenv("SERVER_SALT", "change_this_to_a_random_string_in_production")

    # Rate Limiting (only when payments_enabled=True)
    rl_window_seconds: int = int(os.getenv("RL_WINDOW_SECONDS", "60"))
    rl_max_requests_ip: int = int(os.getenv("RL_MAX_REQUESTS_IP", "30"))

    # Redis (only required when payments_enabled=True)
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # Dev endpoints
    dev_reset_enabled: bool = os.getenv("DEV_RESET_ENABLED", "0") == "1"

    # Payment gateway
    payment_gateway: str = os.getenv("PAYMENT_GATEWAY", "nowpayments").lower()

    # NOWPayments
    nowpayments_api_key: str = os.getenv("NOWPAYMENTS_API_KEY", "")
    nowpayments_ipn_secret: str = os.getenv("NOWPAYMENTS_IPN_SECRET", "")

    # BTCPay Server (alternative gateway)
    btcpay_url: str = os.getenv("BTCPAY_URL", "")
    btcpay_store_id: str = os.getenv("BTCPAY_STORE_ID", "")
    btcpay_api_key: str = os.getenv("BTCPAY_API_KEY", "")
    btcpay_webhook_secret: str = os.getenv("BTCPAY_WEBHOOK_SECRET", "")

    # Pro Plans — read from env (PLAN_1, PLAN_2, PLAN_3).
    # BTC minimum on NOWPayments is ~$10. Lower amounts will fail.
    @property
    def plans(self) -> list[dict]:
        plans = []
        for i in range(1, 4):
            raw = os.getenv(f"PLAN_{i}", "")
            if not raw:
                continue
            parts = raw.split("|")
            if len(parts) >= 4:
                plans.append({
                    "id": parts[0],
                    "title": parts[1],
                    "credits": int(parts[2]),
                    "price_usd": int(parts[3]),
                    "note": parts[4] if len(parts) > 4 else "",
                })
        return plans

    # Database
    db_path: str = os.getenv("DB_PATH", "void.db")

    # Feature flag
    payments_enabled: bool = os.getenv("PAYMENTS_ENABLED", "0") == "1"


settings = Settings()
