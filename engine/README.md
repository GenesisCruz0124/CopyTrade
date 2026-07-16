# CopyTrade Engine

24/7 Node.js + TypeScript trading bot engine for **MEXC Spot and Futures** (grid + DCA strategies), plus an optional Discord-signal copy-trading pipeline for futures. Talks to MEXC directly; the Android app talks only to this engine's REST API.

**Paper mode is the default for both spot and futures**, and they're controlled independently. No real spot orders are sent to MEXC unless `TRADING_MODE=live` is set *and* the bot config has `confirmLive: true`. No real futures orders are sent unless `FUTURES_TRADING_MODE=live` is set *and* `MEXC_FUTURES_ACCESS_KEY`/`SECRET_KEY` are configured *and* `confirmLive: true` is passed. Futures paper mode simulates fills using real live MEXC prices and works even without futures API keys — it governs manual trading, futures bots, and the copy-trading pipeline uniformly.

## Requirements

- Node.js 20+
- A MEXC account with a **Spot** API key (Spot Trade permission only, no withdrawal, IP-whitelisted) for spot bots.
- Optionally, a **separate Futures** API key (MEXC issues Futures keys independently of Spot keys) if you want futures grid/DCA bots or copy trading. Futures API access may require your account to have futures trading enabled first — check this in MEXC before assuming the key will work.
- Optionally, a Discord bot token + Anthropic API key if you want the Discord signal-image copy-trading pipeline.

## Setting up your MEXC API key(s)

**Spot:**
1. Log into MEXC → **Account** → **API Management** → **Create API**.
2. Permissions: enable **Spot Trading** only. Do **not** enable withdrawals.
3. IP whitelist: add the public IP of the server/VPS/Railway instance running this engine.
4. Copy the API key and secret into your `.env` as `MEXC_API_KEY` / `MEXC_API_SECRET`.

**Futures (optional, separate key):**
1. MEXC → **Futures API Management** → **Create API**. This is a distinct key pair from Spot — the futures REST API (`contract.mexc.com`) uses its own signing scheme.
2. Enable Futures Trading permission only, no withdrawal, IP-whitelisted the same way.
3. Set `MEXC_FUTURES_ACCESS_KEY` / `MEXC_FUTURES_SECRET_KEY` in `.env`. These are only required if you set `FUTURES_TRADING_MODE=live` — futures paper mode works without them (leave blank to try futures risk-free before setting up real API access).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEXC_API_KEY` | for live spot mode | — | MEXC Spot API key |
| `MEXC_API_SECRET` | for live spot mode | — | MEXC Spot API secret |
| `TRADING_MODE` | no | `paper` | `paper` (simulated spot) or `live` (real spot orders) |
| `API_AUTH_TOKEN` | yes | — | Bearer token the Android app / any client must send |
| `PORT` / `HOST` | no | `8080` / `0.0.0.0` | Control API bind address |
| `DB_PATH` | no | `./data/copytrade.db` | SQLite database file path |
| `MAX_ORDER_PRICE_DEVIATION_PCT` | no | `5` | Reject orders priced further than this % from market |
| `DEFAULT_DAILY_LOSS_LIMIT_USDT` | no | `50` | Per-bot daily realized-loss cap before auto-pause |
| `LOG_LEVEL` | no | `info` | pino log level |
| `MEXC_FUTURES_ACCESS_KEY` / `MEXC_FUTURES_SECRET_KEY` | for live futures mode | — | Separate Futures API key pair; not needed for futures paper mode |
| `MAX_FUTURES_LEVERAGE` | no | `20` | Hard cap enforced by the safety rail, regardless of what a bot/signal requests |
| `MIN_LIQUIDATION_DISTANCE_PCT` | no | `15` | Reject a futures order if its estimated liquidation price is closer than this % to entry |
| `FUTURES_TRADING_MODE` | no | `paper` | `paper` (simulated futures, real live prices, no keys needed) or `live` (real futures orders) — independent of `TRADING_MODE`, governs manual trading + bots + copy-trading uniformly |
| `FUTURES_PAPER_SEED_BALANCE_USDT` | no | `50000` | Simulated starting USDT balance for futures paper mode; resets every engine restart |
| `DISCORD_BOT_TOKEN` / `DISCORD_SIGNAL_CHANNEL_ID` | for copy trading | — | Bot token + the single channel ID to watch for signal images |
| `ANTHROPIC_API_KEY` | for copy trading | — | Used to extract structured trade data from signal screenshots via Claude vision |
| `SIGNAL_IMAGE_DIR` | no | `./data/copy-signal-images` | Where downloaded signal images are stored |
| `COPY_TRADING_BUDGET_USDT` | no | `100` | Dedicated budget pool copy trades size against |
| `COPY_TRADING_RISK_PCT_PER_TRADE` | no | `2` | % of the budget risked as margin per approved signal |
| `COPY_TRADING_DEFAULT_LEVERAGE` | no | `3` | Used when a signal's leverage couldn't be read from the image |
| `COPY_TRADING_MARGIN_MODE` | no | `isolated` | `isolated` or `cross` |

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

Cancels all open **spot** orders and pauses every bot. Two ways to trigger it:

```bash
npm run killswitch          # CLI, calls the running engine's API
curl -X POST -H "Authorization: Bearer $API_AUTH_TOKEN" http://localhost:8080/killswitch
```

Futures positions are not touched by the kill switch in this v1 — close them manually on MEXC if needed.

## Control API

All endpoints require `Authorization: Bearer $API_AUTH_TOKEN`. Every JSON response includes `"mode": "paper" | "live"`.

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Engine mode, uptime, balances, kill-switch state |
| GET | `/bots` | List all bots (`grid`, `dca`, `futures_grid`, `futures_dca`) |
| POST | `/bots` | Create a bot |
| POST | `/bots/:id/start` | Start a bot |
| POST | `/bots/:id/pause` | Pause a bot |
| POST | `/bots/:id/stop` | Stop a bot |
| DELETE | `/bots/:id` | Delete a bot |
| GET | `/bots/:id/trades` | Recent fills for a bot |
| GET | `/bots/:id/pnl` | PnL snapshot time series |
| GET | `/events?since=` | Event log since a timestamp |
| POST | `/killswitch` | Cancel all open spot orders, pause all bots |
| GET | `/copy-signals?status=` | List copy signals (defaults to all; filter by `PENDING`/`APPROVED`/`REJECTED`/`EXECUTED`/`FAILED`) |
| GET | `/copy-signals/:id/image` | The original signal screenshot |
| POST | `/copy-signals/:id/approve` | Size and place the futures order for a pending signal |
| POST | `/copy-signals/:id/reject` | Discard a pending signal |

### Creating a futures bot

`POST /bots` with `"type": "futures_grid"` or `"type": "futures_dca"` — same fields as the spot `grid`/`dca` config, plus:

```json
{
  "type": "futures_grid",
  "symbol": "BTC_USDT",
  "lowerPrice": 50000,
  "upperPrice": 60000,
  "gridLevels": 10,
  "totalBudgetUsdt": 200,
  "mode": "arithmetic",
  "leverage": 5,
  "marginMode": "isolated",
  "confirmLive": true
}
```

Note the futures symbol format is `BASE_QUOTE` (e.g. `BTC_USDT`), not the spot `BTCUSDT` format.

## Copy trading (Discord signal images → futures orders)

This is a **review-then-execute** pipeline, never fully automatic:

1. A Discord bot (added to your server, watching one channel) picks up image attachments — chart screenshots with entry/SL/TP marked.
2. Each image is sent to Claude's vision API to extract `{symbol, side, leverage, entryPrice, stopLoss, takeProfit, confidence}` as structured data.
3. The result is stored as a `PENDING` copy signal — nothing is traded yet.
4. You review it in the Android app's Copy Signals screen (thumbnail + parsed fields) and tap **Approve** or **Reject**.
5. On approve, the engine sizes the position as `COPY_TRADING_RISK_PCT_PER_TRADE`% of `COPY_TRADING_BUDGET_USDT` as margin, at the signal's leverage (or `COPY_TRADING_DEFAULT_LEVERAGE` if unreadable), and places a futures limit order at the extracted entry price — subject to the same leverage cap and liquidation-distance safety rail as every other futures order.

### Setting up the Discord bot

1. Create an application + bot at the [Discord Developer Portal](https://discord.com/developers/applications), enable the **Message Content** intent under Bot settings.
2. Invite it to your server with `View Channel` + `Read Message History` permissions, scoped to the signal channel.
3. Set `DISCORD_BOT_TOKEN` to the bot's token and `DISCORD_SIGNAL_CHANNEL_ID` to the channel's ID (right-click the channel → Copy Channel ID, with Developer Mode on).

### Known limitations (be aware before trusting this with real money)

- **Vision extraction is not guaranteed correct.** Always check the parsed fields against the actual screenshot before approving — the `confidence` score is the model's own self-assessment, not a hard guarantee.
- **Stop-loss/take-profit from a signal are stored but not automatically placed as separate orders in this v1.** Only the entry order is submitted on approval; managing the SL/TP is on you for now.
- **Position sizing is per-trade, not cumulative.** `COPY_TRADING_BUDGET_USDT` is used to size *each* approved trade's margin — the engine does not currently track running exposure across multiple open copy-trade positions against that same pool. Size `COPY_TRADING_RISK_PCT_PER_TRADE` conservatively if you expect to approve several signals in a short window.
- **No public MEXC "copy another trader's account" API exists (that we could find).** This pipeline works by capturing chart screenshots from *your own* Discord channel, not by subscribing to another account's live orders.

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
3. Attach a volume mounted at `/app/data` so the SQLite database and downloaded signal images survive redeploys.
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

- **MEXC Spot REST/WS clients** (`src/mexc/`) — signed requests, rate-limited queues (20 req/s order endpoints, 10 req/s others), 429 backoff, WS auto-reconnect with jitter before MEXC's 24h connection cap.
- **MEXC Futures REST client** (`src/mexcFutures/`) — a separate signing scheme and REST surface (`contract.mexc.com`) from Spot; wrapped by `FuturesTradingService`, which enforces symbol rounding and the safety rail before every order.
- **Paper exchange** (`src/paper/`) — simulates spot fills from live WS prices behind the same `ExchangeClient` interface the live client implements.
- **Paper futures exchange** (`src/mexcFutures/paperFuturesExchange.ts`) — simulates futures fills using real live MEXC prices behind the same `FuturesExchangeClient` interface `FuturesRestClient` implements. Fully ephemeral: `FUTURES_TRADING_MODE=paper` runs `FuturesPositionManager`/`FuturesPendingOrderManager` against a dedicated in-memory SQLite database (same schema, migrated on startup) rather than the real one, so paper and live futures history can never physically mix and paper state resets on every restart.
- **Strategies** (`src/strategies/`) — spot grid/DCA and their futures counterparts (`futuresGridStrategy.ts`, `futuresDcaStrategy.ts` — leverage-aware, scoped down from the spot versions: futures re-entry after a fill relies on periodic reconciliation rather than a private WS fill stream).
- **Safety rails** (`src/safety/`) — the single choke point every order passes through: budget cap, daily loss auto-pause, price-deviation/balance sanity checks, kill switch, plus futures-only leverage cap and estimated-liquidation-distance checks.
- **Copy signals** (`src/discord/`, `src/vision/`, `src/copySignals/`) — Discord image listener → Claude vision extraction → pending-signal queue → human-approved futures order placement.
- **Persistence** (`src/db/`) — better-sqlite3, WAL mode, migrated on boot (including an in-place migration that adds futures columns to a pre-existing `bots` table without losing data).

## Out of scope for v1

Withdrawal endpoints, multi-user support, automatic stop-loss/take-profit order placement for copy trades, subscribing to another account's live position feed (no such public MEXC API is known to exist).
