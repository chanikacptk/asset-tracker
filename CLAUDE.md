# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks, gold, Thai mutual funds, cash, insurance, and private investments. Includes AI-powered portfolio analysis and monthly DCA plan generation via Claude API.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`) — vanilla JS, no build step, no npm |
| Styling | Inline CSS variables, light/dark theme via `html.dark` class |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend logic | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot |
| PWA | `manifest.json` + `sw.js` (cache-v6) |

**CDN dependencies loaded in `index.html`:**
- `@supabase/supabase-js@2`
- `chart.js@4.4.0`

## Deployment

Push to `main` → GitHub Pages deploys automatically (~30–60s).

```bash
git add <files>
git commit -m "..."
git push origin main
```

No build step. The repo root is served directly as the site.

## Project structure

```
index.html              Main app — all HTML/CSS/JS in one file
manifest.json           PWA manifest
sw.js                   Service worker (cache-first for CDN/shell, network-first for Supabase)
assets/icons/           PWA icons (192px, 512px)
portfolio_tracker.html  Old/prototype file — NOT the active app

gas/
  Code.gs               Orchestrator + web app entry (doGet), trigger setup
  Config.gs             Script Properties wrapper (secrets)
  DataAgent.gs          Market data fetching (Yahoo Finance, CoinGecko, AIMC)
  AnalystAgent.gs       Claude API portfolio analysis → BUY/SELL/HOLD/TRIM signals
  DCAAgent.gs           Monthly DCA plan generation via Claude API
  NewsAgent.gs          News fetching (NewsAPI.org)
  NotificationAgent.gs  Telegram notifications
  ScriptProperties.md   Setup instructions for GAS secrets

supabase/
  schema.sql            Full schema — run once to bootstrap
  seed.sql              Sample data
  migrations/
    001_app_config.sql              app_config table (stores GAS URL)
    002_user_profile.sql            avatar + name columns on users
    003_frontend_write_policies.sql RLS policies for frontend CRUD (holdings, portfolios, watchlist)
    004_portfolio_target_pct.sql    portfolios.target_pct column + UPDATE policy ✓ applied
```

## Authentication

Custom PIN-based auth — **not** Supabase Auth. The `users` table stores `pin_hash` + `salt`. Session is stored in `localStorage` as `{ userId, userName, partnerId }`. The app auto-logs in from localStorage on load.

The anon key (`SUPABASE_ANON_KEY`) is intentionally hardcoded in `index.html` — it is the publishable key, not the service role key.

## RLS design

- **All tables**: `anon_read_all` SELECT policy (frontend reads anything, filters by `user_id` in JS)
- **Frontend writes** (anon key): holdings CRUD, portfolio INSERT+UPDATE, DCA plan approval, private investments/cash updates, watchlist CRUD
- **GAS writes** (service_role key): all market data, AI analyses, DCA plan creation, notifications log, exchange rates, news — service role bypasses RLS entirely

**Never put the `SUPABASE_SERVICE_KEY` in index.html.**

## GAS setup

GAS files must be copy-pasted into the Apps Script IDE — they are not auto-deployed from this repo.

**Script Properties required** (Apps Script → Project Settings → Script Properties):
- `SUPABASE_URL` — `https://zchwqmykjjjtoaymuvwx.supabase.co`
- `SUPABASE_SERVICE_KEY` — service_role key (from Supabase Dashboard → Settings → API)
- `CLAUDE_API_KEY` — Anthropic API key
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `NEWSAPI_KEY` — NewsAPI.org key

**Deploy as Web App**: Deploy → New deployment → Web app → Execute as Me → Anyone.
Save the URL to Supabase `app_config` table (key: `gas_web_app_url`) or via the Settings page in the app.

**Run `setupTriggers()` once** from the GAS IDE to activate:
- Daily @ 8AM → `onDailyTrigger` (fetches data, runs analysis, weekday only)
- Every 5 min → `onRealtimeTrigger` (crypto/gold ±5% alerts, S/R proximity)
- 1st of month (inside daily trigger) → DCA plan generation
- Monday (inside daily trigger) → weekly review

## Key GAS web app actions

Called from the frontend via `callGAS(action, params)`:

| action | handler |
|---|---|
| `fetchData` | DataAgent.fetchAll() |
| `analyzeGrowth` | AnalystAgent.reviewGrowthPortfolios() |
| `analyzeWeekly` | AnalystAgent.reviewDividendAndETF() |
| `generateDCA` | DCAAgent.generatePlans() |
| `fetchNews` | NewsAgent.fetchForAllHoldings() |
| `getPrice` | Yahoo Finance single quote |
| `savePrice` | DataAgent.savePrice() |
| `searchTicker` | Yahoo Finance autocomplete |
| `testTelegram` | Send test notification to all users |

## Important data model notes

- `portfolios.type` has a DB constraint: `CHECK (type IN ('growth', 'dividend', 'etf'))`. The frontend `_createPortfolio()` sets `type` from the slugified name — this **will fail** if the name doesn't produce one of those three values. Known bug, not yet fixed.
- `portfolios.target_pct` — nullable numeric, set by the user from the Home dashboard. Used to show the target allocation bar per portfolio slice.
- `holdings` unique on `(portfolio_id, ticker)` — upsert on conflict.
- `market_data` has no unique constraint; prices are appended as rows. Always query with `order=fetched_at.desc&limit=1` to get the latest.
- `exchange_rates` unique on `(from_currency, to_currency, date)`.
- `dca_plans` unique on `(user_id, month_year)`.
- `users.avatar` and `users.name` (editable) were added via `migrations/002_user_profile.sql` — not in base schema.

## Home dashboard layout

Each user gets a full-width `.uc-card`:
- **Header**: avatar + name (left) / total value + G/L (right)
- **Body** (flex row on ≥640px, stacked on ≤400px):
  - **Donut chart** (left) — one segment per portfolio, colored by `PORTFOLIO_COLORS`, center text shows value + G/L
  - **Slices panel** (right):
    - "Target allocated X% / 100%" bar — green near 100%, yellow/red otherwise
    - One row per portfolio: name + holdings count / value / G/L / current % badge / mini progress bar → target % / ✏️ edit button (own user only)
    - "Other Assets" row (gold, MF, cash, private) if non-zero

Key functions:
- `loadDashboard()` — entry point, fetches both users' data, builds cards, loads recent alerts
- `_buildUserCard(container, key, userId, avatar, name, data, isOwn)` — creates `.uc-card` DOM node
- `_renderDonut(canvasId, legendId, data)` — draws Chart.js doughnut (canvas ids: `donut-my`, `donut-partner`)
- `_renderSlices(containerId, data, isOwn)` — renders portfolio rows (no emoji prefix, just `p.name`)
- `editSliceTarget(portfolioId, currentTarget)` — replaces bar row with inline input
- `saveSliceTarget(portfolioId)` — upserts `portfolios.target_pct`, then re-runs `loadDashboard()`
- `calcUserData(userId)` — aggregates all asset values; returns `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], otherUSD }` where each portfolio has `{ id, name, type, valueUSD, costUSD, gainLossUSD, holdingsCount, targetPct }`

## Frontend state

Global `state` object in `index.html`:
```js
state.userId       // UUID of logged-in user
state.partnerId    // UUID of the other user
state.currency     // 'USD' | 'THB'
state.usdThb       // current exchange rate
state.gasUrl       // GAS web app URL (loaded from app_config)
state.cache        // in-memory price cache { [symbol]: price }
state.charts       // Chart.js instances { [canvasId]: chart }
```

## Pages / navigation

Navigation via `navigate(page)` — shows/hides `.page` divs by id:
`dashboard` | `us` | `more` | `gold` | `mf` | `cash` | `insurance` | `private` | `dca` | `partner` | `settings`

## Service worker cache

Cache name is `smart-me-v6`. **Bump the version string in `sw.js`** whenever you change `index.html`, `manifest.json`, or add a new CDN dependency — otherwise users will see stale content.

## What's NOT implemented yet (schema exists, no UI)

- Crypto holdings (table: `crypto_holdings`)
- Thai bonds (table: `thai_bonds`)
- Watchlist UI (table: `watchlist`)
- Fix: `_createPortfolio()` type bug — hardcoded slug can violate DB CHECK constraint
