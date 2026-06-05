# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks, gold, Thai mutual funds, cash, insurance, and private investments. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`) — vanilla JS, no build step, no npm |
| Fonts | Instrument Sans (body), Google Fonts CDN — Syne/JetBrains Mono loaded but not used in table |
| Styling | CSS variables, light/dark theme via `html.dark` class |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend logic | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot (per-user, per-portfolio) |
| PWA | `manifest.json` + `sw.js` (cache-v6) |

**CDN dependencies in `index.html`:**
- `@supabase/supabase-js@2`
- `chart.js@4.4.0`
- Google Fonts: Instrument Sans, Syne, JetBrains Mono

## Deployment

Push to `main` → GitHub Pages deploys automatically (~30–60s). No build step.

```bash
git add <files>
git commit -m "..."
git push origin main
```

## Project structure

```
index.html              Main app — all HTML/CSS/JS in one file (~2400 lines)
manifest.json           PWA manifest
sw.js                   Service worker (cache-first CDN/shell, network-first Supabase)
assets/icons/           PWA icons (192px, 512px)
portfolio_tracker.html  Prototype/reference — NOT the active app

gas/
  Code.gs               Orchestrator + doGet web app entry + trigger setup
  Config.gs             Script Properties wrapper (secrets)
  DataAgent.gs          Market data: Yahoo Finance, CoinGecko, AIMC NAV scrape
  AnalystAgent.gs       Claude API → BUY/SELL/HOLD/TRIM signals + S/R levels
  DCAAgent.gs           Monthly DCA plan generation via Claude API
  NewsAgent.gs          News fetching via NewsAPI.org
  NotificationAgent.gs  Telegram: per-user per-portfolio daily/weekly/breaking
  ScriptProperties.md   GAS secrets setup guide

supabase/
  schema.sql            Full schema (run once to bootstrap)
  seed.sql              Sample data
  migrations/
    001_app_config.sql              app_config table (stores GAS URL)
    002_user_profile.sql            avatar + name columns on users
    003_frontend_write_policies.sql RLS: holdings CRUD, portfolio INSERT, watchlist
    004_portfolio_target_pct.sql    portfolios.target_pct + UPDATE policy ✓ applied
```

## Authentication

Custom PIN-based auth — **not** Supabase Auth. `users` table stores `pin_hash` + `salt`. Session saved to `localStorage` as `{ userId, userName, partnerId }`. Auto-restores on load.

`SUPABASE_ANON_KEY` is intentionally hardcoded in `index.html` — it is the publishable key only.

## RLS design

- **All tables**: `anon_read_all` SELECT policy — frontend reads everything, filters by `user_id` in JS
- **Frontend writes** (anon key): holdings CRUD, portfolio INSERT + UPDATE (incl. `target_pct`), DCA approval, private investments, cash accounts, watchlist
- **GAS writes** (service_role): market data, AI analyses, DCA plans, notifications log, exchange rates, news — bypasses RLS entirely

**Never put `SUPABASE_SERVICE_KEY` in index.html.**

## GAS setup

GAS files are copy-pasted into the Apps Script IDE — not auto-deployed from this repo.

**Script Properties** (Apps Script → Project Settings → Script Properties):
| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://zchwqmykjjjtoaymuvwx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key (Supabase Dashboard → Settings → API) |
| `CLAUDE_API_KEY` | Anthropic API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `NEWSAPI_KEY` | NewsAPI.org key |

**Deploy as Web App**: Deploy → New deployment → Web app → Execute as Me → Anyone.
Save the URL via Settings page in the app (stored in `app_config` table, key: `gas_web_app_url`).

**Run `setupTriggers()` once** from GAS IDE:
- Daily @ 8AM → `onDailyTrigger` (fetch data → analysis → news → notifications, weekdays only)
- Every 5 min → `onRealtimeTrigger` (crypto/gold ±5%, S/R proximity alerts)
- 1st of month (inside daily) → DCA plan generation
- Monday (inside daily) → weekly review

## GAS web app actions

Called from frontend via `callGAS(action, params)`:

| action | handler | when called |
|---|---|---|
| `fetchData` | DataAgent.fetchAll() | manual / daily trigger |
| `analyzeGrowth` | AnalystAgent.reviewGrowthPortfolios() | daily trigger |
| `analyzeWeekly` | AnalystAgent.reviewDividendAndETF() | weekly trigger |
| `analyzePortfolio` | AnalystAgent.reviewPortfolioById(portfolioId) | **auto after every saveHolding()** |
| `generateDCA` | DCAAgent.generatePlans() | monthly trigger |
| `fetchNews` | NewsAgent.fetchForAllHoldings() | daily/weekly trigger |
| `getPrice` | Yahoo Finance single quote | ticker autocomplete |
| `savePrice` | DataAgent.savePrice() | after saveHolding() |
| `searchTicker` | Yahoo Finance search | ticker autocomplete |
| `testTelegram` | send test message to all users | Settings page |

## Telegram notification flow

`NotificationAgent.gs` sends personalized messages per user per portfolio:

- **Daily** (weekdays after `analyzeGrowth` + `fetchNews`):
  - Groups by Growth portfolio name
  - Each holding: signal emoji + ticker + BUY/HOLD/TRIM/SELL + reasoning + S/R levels
  - High-impact news (last 2 days) for that user's tickers
- **Weekly** (Monday, same structure for Dividend + ETF portfolios, last 7 days news)
- **Breaking news** (`sendHighImpactNewsAlerts`): fires after each `fetchNews`, sends only articles where the ticker is held by that user (last 6h)
- **Realtime alerts**: crypto ±5% (1h), gold ±5% (1d), S/R proximity ±2% — routed to user who holds the asset

## Important data model notes

- `portfolios.type` CHECK constraint: `IN ('growth', 'dividend', 'etf')`. `_createPortfolio()` sets type from slugified name — **will fail** if name doesn't map to one of those three. Known bug, not yet fixed.
- `portfolios.target_pct` — nullable numeric, set from Home dashboard slices panel. Used in the target bar and Gap column.
- `holdings` unique on `(portfolio_id, ticker)` — frontend upserts on conflict.
- `market_data` — no unique constraint, rows appended. Always query `order=fetched_at.desc&limit=1`.
- `exchange_rates` unique on `(from_currency, to_currency, date)`.
- `dca_plans` unique on `(user_id, month_year)`.
- `users.avatar`, `users.name` added via migration 002 — not in base `schema.sql`.

## Home dashboard (`.uc-card`)

Each user gets a full-width card. Layout: header → flex body (donut left, slices right). Stacks on ≤400px.

**Donut chart**: one segment per portfolio (`PORTFOLIO_COLORS`), center text = value + G/L.

**Slices panel**:
- "Target allocated X% / 100%" bar (green ≈100%, yellow/red otherwise)
- One row per portfolio: name · holdings count · value · G/L · current % badge · mini bar → target % · ✏️ (own user only)
- "Other Assets" row (gold + MF + cash + private) if > 0

**Key functions**:
- `loadDashboard()` — fetches both users, builds cards, recent alerts
- `_buildUserCard(container, key, userId, avatar, name, data, isOwn)`
- `_renderDonut(canvasId, legendId, data)` — canvas ids `donut-my` / `donut-partner`
- `_renderSlices(containerId, data, isOwn)` — portfolio rows, no emoji, just `p.name`
- `editSliceTarget(portfolioId, currentTarget)` — inline input in bar row
- `saveSliceTarget(portfolioId)` — updates `portfolios.target_pct`, reloads dashboard
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], otherUSD }`
  - each portfolio: `{ id, name, type, valueUSD, costUSD, gainLossUSD, holdingsCount, targetPct }`

## US Portfolio page (holdings table)

Scrollable table with 13 columns — inherits body font (no monospace override).

| Column | Source |
|---|---|
| Ticker | `holdings.ticker` |
| Shares | `holdings.shares` |
| Avg Cost | `holdings.avg_cost_usd` |
| Price ● | `market_data` (cached in `state.cache`) |
| Value | shares × price |
| P/L $ | value − cost |
| P/L % | (price − avg_cost) / avg_cost |
| Weight | value / portfolio total (bar + %) |
| Target | `holdings.target_pct` |
| Gap | weight − target (TRIM badge if over, DCA badge if under) |
| Signal | latest `ai_analyses.signal` per ticker |
| S/R | `ai_analyses.support_level` / `resistance_level` |
| Actions | ✏️ edit, 🗑 delete |

**Sorting**: click any column header → sort asc (▲); click again → desc (▼); other columns show ⇅. Sort state in `_sortState = { col, dir }`. Data precomputed into `_portTableData[]` — no re-fetch on sort.

**Key functions**:
- `loadPortfolioTab(portfolioId, tabBtn)` — fetches holdings + prices + analyses, precomputes `_portTableData`, renders table shell, calls `_renderPortTbody()`
- `_sortPortCol(col)` — toggles sort direction, calls `_renderPortTbody()`
- `_renderPortTbody()` — sorts `_portTableData`, re-renders `<tbody>` + header indicators
- `_gapCell(gap, target)` — returns colored badge: TRIM / DCA / ≈ok / —
- `_signalBadge(signal)` — BUY/SELL/HOLD/TRIM badge
- `_srCell(analysis)` — green S + red R display
- `savePortfolioName(portfolioId)` — updates DB, calls `loadUSPortfolio()` then re-clicks tab (fixes stale-name bug)

**Auto-analysis**: after every `saveHolding()`, fires `callGAS('analyzePortfolio', { portfolioId })` — Claude generates signals + S/R levels for that portfolio immediately.

## Frontend state

```js
state.userId       // UUID of logged-in user
state.partnerId    // UUID of the other user
state.currency     // 'USD' | 'THB'
state.usdThb       // current exchange rate
state.gasUrl       // GAS web app URL (from app_config)
state.cache        // in-memory price cache { [symbol]: price }
state.charts       // Chart.js instances { [canvasId]: chart }

_portTableData     // precomputed holdings rows for current portfolio tab
_sortState         // { col: string|null, dir: 1|-1 }
```

## Pages / navigation

`navigate(page)` — shows/hides `.page` divs:
`dashboard` | `us` | `more` | `gold` | `mf` | `cash` | `insurance` | `private` | `dca` | `partner` | `settings`

## Service worker cache

Cache name: `smart-me-v6`. **Bump the version string in `sw.js`** whenever `index.html`, `manifest.json`, or CDN deps change — stale cache will serve old JS otherwise.

## What's NOT implemented yet (schema exists, no UI)

- Crypto holdings (`crypto_holdings` table)
- Thai bonds (`thai_bonds` table)
- Watchlist UI (`watchlist` table)
- Fix `_createPortfolio()` type bug — slugified name must produce `growth`, `dividend`, or `etf`
