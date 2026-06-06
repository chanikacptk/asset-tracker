# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks, gold, Thai mutual funds, cash, insurance, and private investments. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`) — vanilla JS, no build step, no npm |
| Fonts | Instrument Sans (body), Syne (headings/tickers), JetBrains Mono (table numbers only) — **do not change** |
| Styling | CSS variables, light/dark theme via `html.dark` class (default: dark) |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend logic | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot (per-user, per-portfolio) |
| PWA | `manifest.json` + `sw.js` (cache-v13) |

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

**Always bump `sw.js` cache version** (currently `smart-me-v13`) when `index.html` changes — stale cache will serve old JS otherwise.

## Project structure

```
index.html              Main app — all HTML/CSS/JS in one file (~3400 lines)
manifest.json           PWA manifest
sw.js                   Service worker (cache-first CDN/shell, network-first Supabase)
assets/
  icons/                PWA icons (192px, 512px)
  banks/                Thai bank logo PNGs (21 files: KBANK.png, SCB.png, BBL.png …)
src/
  config/
    banks.js            THAI_BANKS export — bank codes → { name, nameEN, color, logo }
                        (reference only; the inline THAI_BANKS const in index.html is the live version)
portfolio_tracker.html  Design reference — NOT the active app

gas/
  Code.gs               Orchestrator + doGet web app entry + trigger setup
  Config.gs             Script Properties wrapper (secrets)
  DataAgent.gs          Market data: Yahoo Finance, CoinGecko, AIMC NAV scrape + dynamic S/R
  AnalystAgent.gs       Claude API → BUY/SELL/HOLD/TRIM signals + S/R levels
  DCAAgent.gs           Monthly DCA plan generation via Claude API
  NewsAgent.gs          News fetching via NewsAPI.org
  NotificationAgent.gs  Telegram: per-user per-portfolio daily/weekly/breaking + noise controls
  ScriptProperties.md   GAS secrets setup guide

supabase/
  schema.sql            Full schema (run once to bootstrap)
  seed.sql              Sample data
  migrations/
    001_app_config.sql              app_config table (stores GAS URL)
    002_user_profile.sql            avatar + name columns on users
    003_frontend_write_policies.sql RLS: holdings CRUD, portfolio INSERT, watchlist
    004_portfolio_target_pct.sql    portfolios.target_pct + UPDATE policy ✓ applied
    005_alert_cooldowns.sql         alert_cooldowns table for 24h notification cooldown ✓ applied
    006_cash_accounts_extended.sql  New columns on cash_accounts ✓ applied
    007_cash_accounts_rls_insert_delete.sql  INSERT + DELETE policies for cash_accounts ✓ applied
```

## Authentication

Custom PIN-based auth — **not** Supabase Auth. `users` table stores `pin_hash` + `salt`. Session saved to `localStorage` as `{ userId, userName, partnerId }`. Auto-restores on load.

`SUPABASE_ANON_KEY` is intentionally hardcoded in `index.html` — it is the publishable key only.

## RLS design

- **All tables**: `anon_read_all` SELECT policy — frontend reads everything, filters by `user_id` in JS
- **Frontend writes** (anon key): holdings CRUD, portfolio INSERT + UPDATE (incl. `target_pct`), DCA approval, private investments, cash accounts (INSERT + UPDATE + DELETE), watchlist
- **GAS writes** (service_role): market data, AI analyses, DCA plans, notifications log, exchange rates, news, alert_cooldowns — bypasses RLS entirely

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
- Monday (inside daily) → weekly review + `updateDynamicSRLevels()`

## GAS web app actions

Called from frontend via `callGAS(action, params)`:

| action | handler | when called |
|---|---|---|
| `fetchData` | DataAgent.fetchAll() | manual / daily trigger |
| `analyzeAll` | AnalystAgent.reviewAllPortfolios() | daily + weekly trigger |
| `analyzePortfolio` | AnalystAgent.reviewPortfolioById(portfolioId) | auto after saveHolding() + 🤖 Analyze button |
| `generateDCA` | DCAAgent.generatePlans() | monthly trigger + Monthly Review page |
| `fetchNews` | NewsAgent.fetchForAllHoldings() | daily/weekly trigger |
| `updateSRLevels` | DataAgent.updateDynamicSRLevels() | weekly trigger + manual |
| `getPrice` | Yahoo Finance single quote | ticker autocomplete |
| `savePrice` | DataAgent.savePrice() | after saveHolding() |
| `searchTicker` | Yahoo Finance search | ticker autocomplete |
| `testTelegram` | send test message to all users | Settings page |

`analyzeGrowth` and `analyzeWeekly` still exist in AnalystAgent but are no longer called by triggers — superseded by `analyzeAll`.

## Telegram notification flow

`NotificationAgent.gs` sends personalized messages per user per portfolio:

- **Daily** (weekdays after `analyzeAll` + `fetchNews`):
  - Groups by Growth portfolio name
  - Each holding: signal emoji + ticker + BUY/HOLD/TRIM/SELL + reasoning + S/R levels
  - High-impact news (last 2 days) for that user's tickers
- **Weekly** (Monday, same structure for Dividend + ETF portfolios, last 7 days news)
- **Breaking news** (`sendHighImpactNewsAlerts`): fires after each `fetchNews`, sends only articles where the ticker is held by that user (last 6h)
- **Realtime alerts**: crypto ±5% (1h), gold ±5% (1d), S/R proximity ±1% — routed to user who holds the asset

### Notification noise controls

All realtime alerts and breaking news are subject to:
- **Quiet hours**: no alerts 10PM–7AM Bangkok time (UTC+7)
- **24h cooldown**: same ticker + alert type cannot fire again within 24 hours — tracked in `alert_cooldowns` table (persists across GAS restarts)
- **Daily cap**: max 5 realtime alerts per user per day — counted from `notifications_log`; priority order: crypto > S/R > gold
- **Min price move**: S/R alerts only fire if price moved >1% since the last 5-min check (tracked via GAS `CacheService`)

## Dynamic S/R levels

`DataAgent.updateDynamicSRLevels()` runs weekly (Monday trigger) and on-demand via `updateSRLevels` action:
- Fetches 90-day daily OHLC from Yahoo Finance (`range=3mo`)
- Finds swing highs/lows (3-candle window)
- Combines with 52-week high/low from Yahoo meta
- Adds psychological round-number levels (step size scales with price)
- Writes nearest support (below price) and resistance (above price) to `sr_levels` table

S/R proximity check threshold: **±1%** of level (tightened from ±2%).

Run `testUpdateSRLevels` from GAS IDE to seed initial data after deployment.

## Important data model notes

- `portfolios.type` CHECK constraint: `IN ('growth', 'dividend', 'etf')`. New portfolio modal has a Type selector so `_createPortfolio()` always inserts a valid type.
- `portfolios.target_pct` — nullable numeric, set from Home dashboard. Used in Gap column.
- `holdings` unique on `(portfolio_id, ticker)` — frontend upserts on conflict.
- `market_data` — no unique constraint, rows appended. Always query `order=fetched_at.desc&limit=1`.
- `exchange_rates` unique on `(from_currency, to_currency, date)`. `fetchExchangeRate()` loads **all** currencies into `state.fxRates` (not just USD/THB).
- `dca_plans` unique on `(user_id, month_year)`.
- `alert_cooldowns` unique on `(user_id, ticker, alert_type)` — upserted by GAS after each realtime alert sent.
- `users.avatar`, `users.name` added via migration 002 — not in base `schema.sql`.

### cash_accounts columns (after migration 006)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `name` | text | Account name |
| `sub_type` | text | `'saving'` / `'fixed_deposit'` / `'fcd'` |
| `bank` | text | Bank code (e.g. `'KBANK'`) — links to `THAI_BANKS` |
| `account_number` | text | Optional, display only |
| `currency` | text | `'THB'` for saving/FD; foreign code (USD/EUR/…) for FCD |
| `balance` | numeric | **Always THB principal** for all types. For FCD: `fcd_amount × fcd_purchase_rate` |
| `interest_rate` | numeric | Annual %, nullable |
| `start_date` | date | FD start / FCD purchase date |
| `maturity_date` | date | FD/FCD end/maturity date |
| `duration_months` | integer | FD/FCD duration (auto-calc or manual) |
| `status` | text | `'active'` / `'matured'` (FD only) |
| `fcd_amount` | numeric | Foreign currency units held (FCD only) |
| `fcd_purchase_rate` | numeric | THB per 1 FC unit at purchase (FCD only) |
| `cash_on_hand_thb` | numeric | Physical cash (legacy, not in new form) |

## Thai bank config

`THAI_BANKS` constant is embedded inline in `index.html` (and mirrored in `src/config/banks.js`):

```js
THAI_BANKS = {
  KBANK: { name: 'กสิกรไทย', nameEN: 'Kasikorn',  color: '#138f2d' },
  SCB:   { name: 'ไทยพาณิชย์', nameEN: 'SCB',     color: '#4e2d8c' },
  BBL:   { name: 'กรุงเทพ',    nameEN: 'Bangkok Bank', color: '#1b3f7a' },
  // … 18 more banks
}
```

Logo PNGs live in `assets/banks/{CODE}.png` (e.g. `assets/banks/KBANK.png`).

Helper: `_bankLogoImg(code, size)` — returns `<img>` tag with circular crop + brand-color border.

## Home dashboard

Simplified single-page net worth overview. Always dark-style.

**Layout (top → bottom):**
1. Header row — avatar · name · rate · **USD/THB toggle** · theme toggle
2. Hero — "Combined Net Worth" label + large value (`fmtVal`) + US P/L
3. Per-user row — 2 `card2` tiles side by side: Me | Partner (each: avatar, name, total, P/L %)
4. Allocation donut with **Me / Combined toggle** in the card header
5. 2×2 `card2` metric grid — US Portfolio · Cash · Gold · Other (MF+Private+Insurance); tapping US/Cash navigates there
6. Rate updated date

**Donut:**
- Segments: US Portfolio (#3b82f6) · Cash (#06b6d4) · Gold (#fbbf24) · Mutual Fund (#a855f7) · Crypto (#f97316) · Insurance (#ec4899) · Private (#94a3b8)
- Me/Combined toggle switches without re-fetching — uses `_dbCache`
- Center text and tooltips use `fmtVal()` (respects USD/THB toggle)

**Key functions:**
- `loadDashboard()` — fetches both users in parallel, sets `_dbCache`, renders all sections
- `switchDonutMode(mode)` — 'me' | 'combined', re-renders donut from cache
- `_refreshDonut()` — builds segment array from `_dbCache` per current mode, calls `_renderHomeDonut()`
- `_renderHomeDonut(canvasId, legendId, segments, totalUSD)` — creates/replaces Chart.js doughnut
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], cashUSD, cashBreakdown, goldUSD, mfUSD, privateUSD, insuranceUSD, cryptoUSD, otherUSD }`
  - `cashBreakdown: { savingTHB, fdTHB, fcdTHB }`
  - `otherUSD = goldUSD + mfUSD + privateUSD + insuranceUSD`
  - fetches insurance `surrender_value_thb` and converts to USD

## Cash page

3 account types with full Add/Edit/Delete via modal. Bank logos displayed on cards.

**Account types:**

| Type | Key fields |
|---|---|
| Savings | balance (THB), optional interest rate |
| Fixed Deposit | balance (principal THB), start/end date ↔ duration months (bidirectional), interest rate, expected interest (auto: principal × rate × days/365), status (Active/Matured) |
| FCD | foreign currency + amount + purchase rate → THB principal auto-calc; current rate from `exchange_rates` table; FX gain/loss shown on card |

**Modal UX:**
- Type toggle shown first
- Bank picker: grid of logos with brand-color highlight on selection
- Balance field: `type="text"` with `formatCashBalance()` comma formatter (e.g. `1,000,000`); read-only for FCD (auto-filled from amount × rate)
- FD: start date ↔ end date ↔ duration bidirectional auto-calc; live expected interest updates as you type
- FCD: changing currency pre-fills purchase rate from `state.fxRates` if available

**Key functions:**
- `loadCash()` — fetches accounts, pre-loads FX rates for FCD currencies, renders cards by sub_type
- `openAddCash()` / `openEditCash(id)` — edit fetches full record from DB by ID
- `saveCashAccount()` — validates per type, computes FCD balance as `fcd_amount × fcd_purchase_rate`
- `_renderSavingCard()` / `_renderFdCard()` / `_renderFcdCard()` — per-type card HTML
- `_getCashFxRate(currency)` — returns rate from `state.fxRates`, falls back to `state.usdThb` for USD
- `calcFdDuration()` / `calcFdEndFromDuration()` / `calcFdInterest()` — FD auto-calc helpers
- `calcFcdThbEquiv()` / `calcFcdDuration()` / `calcFcdEndFromDuration()` — FCD auto-calc helpers
- `formatCashBalance()` — formats balance input with thousands commas; `_parseCashBal()` strips them for saving

## US Portfolio page

**Layout:**
1. Top bar — "US Portfolio" title + USD/THB toggle + Add (+) button
2. **Allocation donut card** — compact 90px donut + legend (portfolio name, value, P/L, %) — rendered by `_renderUSAllocDonut()`
3. Tab bar — one tab per portfolio
4. Holdings table for selected tab

**Allocation donut** (`_renderUSAllocDonut()`): calls `calcUserData` to get portfolio values, renders a small doughnut showing relative weight of each portfolio. Non-blocking (runs after tabs are built).

**Holdings table (13 columns):**

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

**Sorting**: click column header → asc ▲ / desc ▼. Sort state in `_sortState = { col, dir }`. Data precomputed into `_portTableData[]`.

**Key functions:**
- `loadUSPortfolio()` — builds tabs, calls `_renderUSAllocDonut()`, loads first tab
- `loadPortfolioTab(portfolioId, tabBtn)` — fetches holdings + prices + analyses, builds table
- `_renderPortTbody()` — sorts and renders `<tbody>`; uses `.b-buy/.b-sell/.b-hold/.b-trim` badges
- `_gapCell(gap, target)` / `_signalBadge(signal)` / `_srCell(analysis)`
- `runPortfolioAnalysis(portfolioId, btn)` — calls GAS `analyzePortfolio`, reloads tab on done

**Analysis triggers:**
- Auto: fires `callGAS('analyzePortfolio', { portfolioId })` after every `saveHolding()`
- Manual: 🤖 Analyze button per tab
- Scheduled: GAS daily trigger @ 8AM covers all portfolios

## Frontend state

```js
state.userId       // UUID of logged-in user
state.partnerId    // UUID of the other user
state.currency     // 'USD' | 'THB'
state.usdThb       // current USD/THB rate
state.fxRates      // { [currency]: rate } — all rates vs THB from exchange_rates table
state.gasUrl       // GAS web app URL (from app_config)
state.cache        // in-memory price cache { [symbol]: price }
state.charts       // Chart.js instances { [canvasId]: chart }

_portTableData     // precomputed holdings rows for current portfolio tab
_sortState         // { col: string|null, dir: 1|-1 }
_dbCache           // { my: calcUserData result, partner: calcUserData result } — home donut cache
_dbDonutMode       // 'me' | 'combined' — current home donut scope
_cashEditId        // ID of cash account being edited (null = add mode)
_cashSelectedBank  // currently selected bank code in cash modal
_cashType          // 'saving' | 'fixed_deposit' | 'fcd'
_cashFdStatus      // 'active' | 'matured'
```

## CSS design system

Dark theme variables (active by default via `html.dark` on `<html>`):
```css
--bg: #06070a       /* page background */
--surface: #0d0f14  /* card background */
--surface2: #13161e /* card2 / input background */
--border: rgba(255,255,255,.07)
--text: #e2e6f0
--text-muted: #5a6278
--success: #16a34a  --danger: #dc2626  --warning: #d97706
--accent: #2563eb (light) / #4f9eff (dark)
```

Reference design system classes (from `portfolio_tracker.html`):
- `.card2` — secondary card (darker background, 9px radius)
- `.g2x` / `.g4x` — 2 or 4 column grid layouts
- `.m-lbl` / `.m-val` / `.m-sub` — metric label/value/subtitle (body font, no monospace)
- `.b-buy` / `.b-sell` / `.b-hold` / `.b-trim` / `.b-dca` — signal badges
- `.gc` / `.rc` / `.ac` — green/red/amber color utility classes
- `.mono` — JetBrains Mono (table numbers only)
- `.pt-badge` — base badge class for portfolio table

## Pages / navigation

6-tab bottom nav: **Home · US · Cash · Asset · Analysis · Setting**

`navigate(page)` — shows/hides `.page` divs. Nav highlight logic:
- `nav-analysis` lights up for: `analysis`, `monthly`, `weekly`, `allportfolio`, `dca`
- `nav-more` (Asset) lights up for: `gold`, `mf`, `insurance`, `private`
- `nav-cash` lights up for: `cash`
- All other pages: `nav-${page}` matches directly

```
dashboard   Home tab
us          US Portfolio tab
cash        Cash tab (savings, FD, FCD)
more        Asset hub → gold | mf | insurance | private
analysis    Analysis hub → dca | monthly | weekly | allportfolio
settings    Setting tab
```

### Analysis hub pages

| Page | Description |
|---|---|
| `dca` | DCA Plan — view/edit/approve current month's allocation |
| `monthly` | Monthly Review — trigger `generateDCA`, view plan summary |
| `weekly` | Weekly Review — trigger `analyzeAll`, view 7-day signals by portfolio |
| `allportfolio` | All Portfolio — read-only view of every holding's latest AI signal |

## Service worker cache

Cache name: **`smart-me-v13`**. Bump whenever `index.html`, `manifest.json`, or CDN deps change.

## What's NOT implemented yet (schema exists, no UI)

- Crypto holdings (`crypto_holdings` table)
- Thai bonds (`thai_bonds` table)
- Watchlist UI (`watchlist` table)
- Partner View (page + `page-partner` HTML exist but no nav entry — accessible via direct `navigate('partner')` call only)
