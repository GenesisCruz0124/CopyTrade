# CopyTrade Engine

24/7 Node.js + TypeScript trading bot engine for **MEXC Spot only** (grid + DCA strategies). Talks to MEXC directly; the Android app talks only to this engine's REST API.

**Paper mode is the default.** No real orders are sent to MEXC unless `TRADING_MODE=live` is set *and* the bot config has `confirmLive: true`.

## Requirements

- Node.js 20+
- A MEXC account with an API key that has **Spot Trade permission only** — no withdrawal permission, IP-whitelisted to your server.

## Setting up your MEXC API key

1. Log into MEXC → **Account** → **API Management** → **Create API**.
2. Permissions: enable **Spot Trading** only. Do **not** enable withdrawals.
3. IP whitelist: add the public IP of the server/VPS/Railway instance running this engine. MEXC requires an IP whitelist for trade-enabled keys.
4. Copy the API key and secret into your `.env` (never commit this file).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEXC_API_KEY` | for live mode | — | MEXC API key (spot trade only) |
| `MEXC_API_SECRET` | for live mode | — | MEXC API secret |
| `TRADING_MODE` | no | `paper` | `paper` (simulated) or `live` (real orders) |
| `API_AUTH_TOKEN` | yes | — | Bearer token the Android app / any client must send |
| `PORT` | no | `8080` | Control API port |
| `HOST` | no | `0.0.0.0` | Control API bind host |
| `DB_PATH` | no | `./data/copytrade.db` | SQLite database file path |
| `MAX_ORDER_PRICE_DEVIATION_PCT` | no | `5` | Reject orders priced further than this % from market |
| `DEFAULT_DAILY_LOSS_LIMIT_USDT` | no | `50` | Per-bot daily realized-loss cap before auto-pause |
| `LOG_LEVEL` | no | `info` | pino log level |

Copy `.env.example` to `.env` and fill in the values.

## Local development

```bash
npm install
cp .env.example .env   # edit values
npm run dev             # tsx watch mode
npm test                 # vitest
npm run typecheck
```

## Kill switch

Cancels all open orders and pauses every bot. Two ways to trigger it:

```bash
npm run killswitch          # CLI, calls the running engine's API
curl -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" http://localhost:8080/killswitch
```

## Control API

All endpoints require `Authorization: Bearer $API_AUTH_TOKEN`. Every JSON response includes `"mode": "paper" | "live"`.

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Engine mode, uptime, balances, kill-switch state |
| GET | `/bots` | List all bots |
| POST | `/bots` | Create a bot (grid or dca config) |
| POST | `/bots/:id/start` | Start a bot |
| POST | `/bots/:id/pause` | Pause a bot |
| POST | `/bots/:id/stop` | Stop a bot |
| DELETE | `/bots/:id` | Delete a bot |
| GET | `/bots/:id/trades` | Recent fills for a bot |
| GET | `/bots/:id/pnl` | PnL snapshot time series |
| GET | `/events?since=` | Event log since a timestamp |
| POST | `/killswitch` | Cancel all open orders, pause all bots |

## Deploying

### Docker / docker-compose (any VPS)

```bash
cp .env.example .env   # edit values
docker compose up -d --build
```

Data persists in the `copytrade-data` named volume (SQLite, WAL mode).

### Railway

1. Create a new Railway project from this repo, root directory `engine/`.
2. Railway auto-detects the `Dockerfile`. Set the environment variables from the table above in the Railway dashboard.
3. Attach a volume mounted at `/app/data` so the SQLite database survives redeploys.
4. Deploy. The control API will be reachable at the Railway-assigned domain on the port Railway routes to `$PORT`.

### Generic VPS (no Docker)

```bash
git clone <repo> && cd engine
npm ci
npm run build
cp .env.example .env   # edit values
npm start
```

Run it under a process manager (systemd, pm2) so it restarts automatically. Orders are idempotent via client order IDs persisted in SQLite, so a restart never duplicates an order — in-flight orders are reconciled via `queryOrder` rather than blindly retried.

## Architecture notes

- **MEXC REST/WS clients** (`src/mexc/`) — signed requests, rate-limited queues (20 req/s order endpoints, 10 req/s others), 429 backoff, WS auto-reconnect with jitter before MEXC's 24h connection cap.
- **Paper exchange** (`src/paper/`) — simulates fills from live WS prices behind the same `ExchangeClient` interface the live client implements, so strategies are exchange-agnostic.
- **Strategies** (`src/strategies/`) — grid (arithmetic/geometric levels) and DCA (scheduled buys, dip multiplier, take-profit).
- **Safety rails** (`src/safety/`) — the single choke point every order passes through: budget cap, daily loss auto-pause, price-deviation/balance sanity checks, kill switch.
- **Persistence** (`src/db/`) — better-sqlite3, WAL mode, migrated on boot.

## Out of scope for v1

Futures/margin trading, copying other traders' accounts, withdrawal endpoints, multi-user support.
