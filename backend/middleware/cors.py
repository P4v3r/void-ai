"""CORS middleware configuration."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def setup_cors(app: FastAPI) -> None:
    """Add CORS middleware to the FastAPI application.

    CORS_ALLOW_ORIGINS can be set to:
    - "*" to allow all origins (development)
    - A comma-separated list of allowed origins (production)
      e.g. "https://mydomain.com,https://app.mydomain.com"
    """
    raw = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()

    if raw == "*":
        origins = ["*"]
    else:
        origins = [o.strip() for o in raw.split(",") if o.strip()] or ["*"]

    # Only expose rate-limit headers (free/pro headers removed)
    expose = [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "Retry-After",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=expose,
    )
