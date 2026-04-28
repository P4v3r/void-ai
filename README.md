<div align="center">

# VOID-AI

**Privacy-first, self-hosted AI chat interface.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

A clean, local chat UI for [Ollama](https://ollama.com) — or run it on a server to **sell AI access** with crypto payments. Zero telemetry, zero accounts, zero tracking.

</div>

---

## Two Modes

| | Self-Hosted (default) | Payment Mode |
|---|---|---|
| **Use case** | Personal AI assistant | Sell AI access to users |
| **Configuration** | None required | `.env` with gateway details |
| **Limits** | Unlimited | Rate-limited, credit-based |
| **Redis** | Not needed | Required |
| **Payments** | Hidden | NOWPayments (BTC, XMR, +50 coins) or BTCPay Server |

---

## Quick Start

### Self-Hosted

No configuration needed. Just run:

```bash
git clone https://github.com/P4v3r/void-ai.git
cd void-ai
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Make sure [Ollama](https://ollama.com) is running on `localhost:11434`.

### Requirements

- **Ollama** running locally (default: `http://localhost:11434`)
- **Docker & Docker Compose** (recommended) — or Python 3.11+ and Node.js 20+ for manual setup

### Change AI Backend URL

If Ollama runs on another server, open **Settings** → **Advanced Settings** → **AI Backend URL**, enter your URL (e.g. `http://192.168.1.50:11434`), click **Set URL**. No file to edit.

---

## Manual Setup

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Configuration

Copy the example file and customize:

```bash
cp backend/.env.example backend/.env
```

### Self-Hosted Mode (Default)

No file needed. If you want to change the Ollama URL, add:

```env
OLLAMA_BASE_URL=http://localhost:11434
```

That's it. No Redis, no limits, no payments.

### Payment Mode (Selling Access)

Set `PAYMENTS_ENABLED=1` and configure a payment gateway:

```env
PAYMENTS_ENABLED=1
PAYMENT_GATEWAY=nowpayments   # or "btcpay"

# ── NOWPayments (recommended — BTC, XMR, 50+ coins) ──
NOWPAYMENTS_API_KEY=your_key_here
NOWPAYMENTS_IPN_SECRET=your_secret_here

# ── BTCPay Server (alternative — self-hosted, zero fees) ──
# BTCPAY_URL=
# BTCPAY_STORE_ID=
# BTCPAY_API_KEY=
# BTCPAY_WEBHOOK_SECRET=

# ── Server & Security ──
SERVER_SALT=generate_a_long_random_string_here
REDIS_URL=redis://localhost:6379/0
```

### Pro Plans

Define your plans in `.env`. Each plan is: `id|title|credits|price_usd|note`

```env
# BTC minimum on NOWPayments is ~$10. Lower amounts will be rejected.
PLAN_1=starter|Starter|500|10|Quick test.
PLAN_2=plus|Plus|2000|20|Best value.
PLAN_3=max|Max|5000|50|Heavy usage.
```

Plans are loaded at startup and **cannot be modified via the UI**. The admin configures them in `.env`.

### Rate Limiting

```env
RL_WINDOW_SECONDS=60       # Time window for IP rate limiting
RL_MAX_REQUESTS_IP=30      # Max requests per IP per window (anti-DDoS)
```

---

## Setting Up NOWPayments

NOWPayments handles **automatic crypto payments** for BTC, XMR, ETH, USDT and 50+ cryptocurrencies. No wallet management needed.

### 1. Create an Account

Sign up at [nowpayments.io](https://account.nowpayments.io) and verify your email.

### 2. Configure Payout Wallet

In the dashboard, go to **Settings** → **Withdrawal settings** and enter your wallet address (where you want to receive the funds).

### 3. Generate API Key

Go to **Settings** → **API Key** → click **Generate**. Copy the key and the **IPN Secret** (save it immediately — it's shown only once).

### 4. Configure VOID AI

Add to your `.env`:

```env
PAYMENTS_ENABLED=1
PAYMENT_GATEWAY=nowpayments
NOWPAYMENTS_API_KEY=your_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_secret
REDIS_URL=redis://localhost:6379/0
```

### How It Works

```
User selects plan → Backend calls NOWPayments API → NOWPayments generates a unique crypto address
        ↓
User sends crypto to that address → NOWPayments processes & confirms
        ↓
NOWPayments sends webhook to backend → Backend creates pro token → User gets access
```

**The frontend polls** the backend every 10 seconds to check if the payment was confirmed. When confirmed, the token is automatically activated.

### Webhook (IPN) Setup

For automatic token activation, NOWPayments needs a publicly accessible URL to send webhook callbacks. If your server has a public domain, configure the IPN callback URL in NOWPayments dashboard.

**For local testing:** The frontend payment modal handles this via polling — no webhook URL needed. The user will see the payment confirmed within ~30 seconds of the blockchain confirmation.

### Important: BTC Minimum

NOWPayments has a **minimum payment amount** of ~$10 for Bitcoin. Plans below this threshold will be rejected. You can use XMR or other cryptocurrencies for lower minimums.

---

## Setting Up BTCPay Server

BTCPay Server is a **self-hosted, zero-fee** payment processor. More complex to set up but gives you full control.

### 1. Install BTCPay Server

```bash
# Quick install
git clone https://github.com/btcpayserver/btcpayserver-docker
cd btcpayserver-docker
./btcpay-setup.sh -i
```

### 2. Create a Store & API Key

- Go to **Stores** → **Create Store**
- Go to **Store Settings** → **API Keys** → **Generate**
- Enable: "Can create invoices", "Can view invoices", "Can modify stores"

### 3. Configure VOID AI

```env
PAYMENTS_ENABLED=1
PAYMENT_GATEWAY=btcpay
BTCPAY_URL=https://your-btcpay-domain.com
BTCPAY_STORE_ID=your_store_id
BTCPAY_API_KEY=your_api_key
BTCPAY_WEBHOOK_SECRET=your_webhook_secret
REDIS_URL=redis://localhost:6379/0
```

---

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌──────────┐
│  Frontend   │  HTTP   │     Backend      │  Ollama │  Ollama  │
│  Next.js 16 │ ◄─────► │   FastAPI        │ ◄─────► │  Server  │
│  React 19   │         │   SQLite         │         │          │
└─────────────┘         └──────────────────┘         └──────────┘
     Browser                   Backend                   AI
          │                          │
          │            ┌──────────────────────┐
          │            │  Payment Gateway      │
          │            │  NOWPayments/BTCPay   │
          │            │  + Redis (rate limit)  │
          │            └──────────────────────┘
```

### Key Design Decisions

- **Frontend is client-side only** — `"use client"`, no SSR. All data in LocalStorage.
- **Backend is stateless** (except Redis for rate limiting and SQLite for pro tokens).
- **NO user data stored** — IPs and browser fingerprints are HMAC-hashed server-side. Raw data is never persisted.
- **Rate limiting uses rotating salts** — each 60-second window uses a unique derived salt, so even if the server salt leaks, old hashes cannot be brute-forced.
- **Payment plans are server-authoritative** — credits and prices are validated server-side from `.env`, never trusted from the frontend.
- **No free tier** — when payments are enabled, only pro tokens grant access (no easily-bypassed free credits with fingerprint tracking).

---

## Project Structure

```
void-ai/
├── backend/
│   ├── main.py           # App entry point
│   ├── config/
│   │   └── settings.py   # All env vars + plan parsing
│   ├── db/
│   │   └── sqlite.py     # Schema + auto-migrations
│   ├── middleware/
│   │   ├── auth.py        # Rate limiting + pro token validation
│   │   ├── cors.py
│   │   └── rate_limit.py  # Redis Lua scripts
│   ├── models/
│   │   └── pydantic.py    # Request/response models
│   ├── routes/
│   │   ├── chat.py        # POST /chat/stream
│   │   ├── config.py      # GET /config, POST /configure/ai-url
│   │   ├── models.py      # GET /models
│   │   ├── pro.py         # GET /pro/status, GET /pro/pending-payment/:id
│   │   └── payment.py     # POST /create-payment, POST /nowpayments-webhook
│   ├── services/
│   │   ├── ollama.py      # Ollama API (models + chat streaming)
│   │   └── nowpayments.py # NOWPayments API wrapper
│   ├── state/
│   │   └── redis_state.py # Shared Redis connection
│   └── utils/
│       ├── crypto_utils.py  # Token hashing, HMAC, webhook sig verification
│       └── helpers.py       # IP extraction, message building
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx     # Orchestrator (all state)
│       │   ├── layout.tsx   # Root layout + fonts
│       │   └── globals.css  # CSS custom properties (themes)
│       └── components/
│           ├── layout/      # Sidebar, TopBar, Composer
│           ├── chat/        # ChatContainer, MessageBubble
│           ├── modals/      # Wallet, PaymentDetails, Settings
│           └── shared/      # ModelSelector
└── compose.yaml             # Docker Compose (backend + frontend)
```

---

## Privacy

**What we DON'T store:**
- No accounts, no email addresses, no usernames
- No browsing data or telemetry
- No chat logs on the server
- Raw IP addresses or browser fingerprints

**What we DO store:**
- **SQLite:** Pro tokens (SHA-256 hashed), invoices (minimal: order ID, amount, status)
- **Redis (payment mode only):** Rate-limit counters per IP (expires after 60s with rotating salt)
- **Browser LocalStorage:** Chat history, selected model, theme preference

**Data portability:** Users can export all their chat history as JSON from Settings.

---

## License

[MIT](LICENSE) © 2024–2026 VOID AI
