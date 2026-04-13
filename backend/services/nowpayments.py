"""NOWPayments API service.

Handles payment creation, status checks, and price estimation.
Docs: https://documenter.getpostman.com/view/7907941/2s93JusNJt
"""

import httpx

from config.settings import settings

BASE_URL = "https://api.nowpayments.io/v1"
HEADERS = {"x-api-key": settings.nowpayments_api_key, "Content-Type": "application/json"}


async def create_payment(
    price_amount: float,
    price_currency: str,
    pay_currency: str,
    order_id: str,
    order_description: str,
    ipn_callback_url: str,
) -> dict:
    """Create a new payment on NOWPayments.

    Returns the payment object containing:
    - payment_id, pay_address, pay_amount, pay_currency
    - payment_status, payment_url
    """
    payload: dict = {
        "price_amount": price_amount,
        "price_currency": price_currency,
        "pay_currency": pay_currency,
        "order_id": order_id,
        "order_description": order_description,
    }
    if ipn_callback_url:
        payload["ipn_callback_url"] = ipn_callback_url

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/payment",
            headers=HEADERS,
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def get_payment_status(payment_id: int) -> dict:
    """Get the status of a specific payment."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/payment/{payment_id}",
            headers=HEADERS,
        )
        resp.raise_for_status()
        return resp.json()


async def get_estimated_price(
    price_amount: float,
    price_currency: str,
    pay_currency: str,
) -> float:
    """Estimate how much crypto is needed for a given USD amount."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/estimate",
            headers=HEADERS,
            params={
                "price_amount": price_amount,
                "price_currency": price_currency,
                "pay_currency": pay_currency,
            },
        )
        resp.raise_for_status()
        return float(resp.json().get("estimated_amount", 0))


async def get_min_payment_amount(pay_currency: str, price_currency: str = "usd") -> float:
    """Get minimum payment amount for a currency pair."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/min-amount/{pay_currency}",
            headers=HEADERS,
            params={"currency": price_currency, "fiat_equivalent": "usd"},
        )
        resp.raise_for_status()
        return float(resp.json().get("min_amount", 0))
