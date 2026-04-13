"""Cryptographic utility functions for token hashing, HMAC signing, and signature verification."""

import hashlib
import hmac

from config.settings import settings


def hash_token(token: str) -> str:
    """SHA-256 hash of a pro token. Used to store tokens without exposing them in the database."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def secure_hash(data: str) -> str:
    """Create a secure HMAC-SHA256 hash using SERVER_SALT.

    This ensures raw fingerprint/IP data is never stored — only the salted hash.
    """
    return hmac.new(
        settings.server_salt.encode(), data.encode(), hashlib.sha256
    ).hexdigest()


def verify_btcpay_sig(raw_body: bytes, btcpay_sig: str, secret: str) -> bool:
    """Verify BTCPay Server webhook signature."""
    if not btcpay_sig or not btcpay_sig.startswith("sha256="):
        return False
    their = btcpay_sig.split("=", 1)[1].strip()
    mac = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, their)
