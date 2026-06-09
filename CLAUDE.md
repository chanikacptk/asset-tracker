# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks/ETFs, gold, Thai mutual funds, cash (savings/FD/FCD), insurance, and private investments. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`, ~4 000 lines) — vanilla JS, no build step |
| Fonts | Instrument Sans (body), Syne (headings/tickers), JetBrains Mono (table numbers only) — **do not change** |
| Styling | CSS variables, dark/light via `html.dark` (default: dark) |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot (per-user chat IDs) |
| PWA | `manifest.json` + `sw.js` (cache `smart-me-v24`) |

CDN deps in `index.html`: `@supabase/supabase-js@2`, `chart.js@4.4.0`, Google Fonts.

## Deployment

```bash
git add <files>
git commit -m "..."
git push origin main   # GitHub Pages auto-deploys in ~60s
```

**Always bump `sw.js` cache version** (`smart-me-vN`) when `index.html` changes.  
`index.html` is served **network-first** by the SW — a normal refresh picks up changes after deploy.

## Project structure

```
index.html              Main app — all HTML/CSS/JS (~4 000 lines)
sw.js                   Service worker (cache-first CDN, network-first app shell)
manifest.json           PWA manifest
portfolio_tracker.html  Design reference — NOT the active app

gas/
  Code.gs               Orchestrator, doGet entry, trigger setup
  Config.gs             Script Properties wrapper
  DataAgent.gs          Market data: Yahoo Finance, CoinGecko, AIMC NAV, S/R levels
  AnalystAgent.gs       Claude API → BUY/SELL/HOLD/TRIM signals
  DCAAgent.gs           Monthly DCA plan generation
  NewsAgent.gs          NewsAPI.org fetching
  NotificationAgent.gs  Telegram: daily/weekly/breaking/realtime alerts
  ScriptProperties.md   GAS secrets setup guide

supabase/
  schema.sql            Full schema (bootstrap once)
  seed.sql              Sample data
  migrations/           008 migrations — all applied ✓
```

## Authentication

Custom PIN auth — **not** Supabase Auth. `users` table stores `pin_hash` + `salt`. Session in `localStorage` as `{ userId, userName, partnerId }`. Auto-restores on load.

`SUPABASE_ANON_KEY` is intentionally hardcoded in `index.html` — it is the publishable key only. **Never put `SUPABASE_SERVICE_KEY` in index.html.**

---

## Database tables

### Auth
| Table | Key columns |
|---|---|
| `users` | id, name, pin_hash, salt, avatar, telegram_chat_id |
| `user_sessions` | id, user_id, token, expires_at |

### US Portfolios
| Table | Key columns |
|---|---|
| `portfolios` | id, user_id, name, type (`growth`/`dividend`/`etf`), target_pct, dca_budget_usd |
| `holdings` | id, portfolio_id, ticker, shares, avg_cost_usd, target_pct |
| `watchlist` | id, user_id, ticker, notes |

### Assets
| Table | Key columns |
|---|---|
| `gold_holdings` | id, user_id, name, purchase_date, troy_oz, avg_cost_usd, notes |
| `mutual_fund_holdings` | id, user_id, fund_code, fund_name, category (`RMF`/`ESG`/`other`), units, buy_price_thb |
| `cash_accounts` | id, user_id, name, sub_type (`saving`/`fixed_deposit`/`fcd`), bank, balance (always THB), currency, interest_rate, start/maturity_date, fcd_amount, fcd_purchase_rate |
| `insurance_policies` | id, user_id, policy_name, annual_premium_thb, surrender_value_thb |
| `private_investments` | id, user_id, name, current_valuation, currency |
| `crypto_holdings` | id, user_id, coin_id, symbol, quantity, avg_cost_usd *(schema only, no UI)* |
| `thai_bonds` | id, user_id, bond_name, face_value_thb, coupon_rate *(schema only, no UI)* |

### Market & Rates
| Table | Key columns |
|---|---|
| `market_data` | id, symbol, asset_type, price, currency, fetched_at — **no unique constraint; always query `order=fetched_at.desc&limit=1`** |
| `exchange_rates` | id, from_currency, to_currency, rate, date — unique on (from, to, date) |
| `sr_levels` | id, ticker, support, resistance, timeframe (`weekly`), created_at |

### AI & DCA
| Table | Key columns |
|---|---|
| `ai_analyses` | id, ticker, portfolio_id, signal, reasoning, support_level, resistance_level |
| `dca_plans` | id, user_id, month_year, status (`draft`/`approved`/`executed`) |
| `dca_plan_items` | id, plan_id, ticker, suggested_amount_usd, adjusted_amount_usd, is_approved |

### Notifications
| Table | Key columns |
|---|---|
| `news_items` | id, ticker, title, source_name, url, published_at, is_high_impact |
| `notifications_log` | id, user_id, notification_type, sent_at |
| `alert_cooldowns` | id, user_id, ticker, alert_type, last_sent_at — unique on (user_id, ticker, alert_type) |
| `app_config` | key, value — stores `gas_web_app_url` |

### RLS pattern
- All tables: `anon_read_all` SELECT policy (frontend filters by `user_id` in JS)
- Frontend (anon key) can write: `holdings`, `portfolios`, `watchlist`, `cash_accounts`, `gold_holdings`, `dca_plan_items`, `private_investments`, `mutual_fund_holdings`
- GAS uses `service_role` key (bypasses RLS entirely)

### Migrations applied (all ✓)
```
001  app_config table
002  users.avatar + name
003  frontend write RLS (holdings, portfolios, watchlist)
004  portfolios.target_pct
005  alert_cooldowns table
006  cash_accounts extended columns (FD/FCD)
007  cash_accounts INSERT/DELETE RLS
008  gold_holdings.name + purchase_date + write RLS
```

---

## GAS setup

Files are copy-pasted into Apps Script IDE — not auto-deployed from this repo.

**Script Properties:**
| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://zchwqmykjjjtoaymuvwx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `CLAUDE_API_KEY` | Anthropic key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `NEWSAPI_KEY` | NewsAPI.org key |

**Deploy as Web App**: Execute as Me → Anyone. Save URL in app Settings page (`app_config` table).

**Run `setupTriggers()` once** from GAS IDE:
- Daily @ 8AM → `onDailyTrigger` (weekdays: fetch → analyze → news → notify; monthly on day 1; weekly on Monday)
- Every 5 min → `onRealtimeTrigger` (crypto/gold ±5%, S/R proximity ±1%)

## GAS web app actions

Called from frontend via `callGAS(action, params)`:

| action | handler |
|---|---|
| `fetchData` | DataAgent.fetchAll() |
| `analyzeAll` | AnalystAgent.reviewAllPortfolios() |
| `analyzePortfolio` | AnalystAgent.reviewPortfolioById(portfolioId) |
| `generateDCA` | DCAAgent.generatePlans() |
| `fetchNews` | NewsAgent.fetchForAllHoldings() |
| `updateSRLevels` | DataAgent.updateDynamicSRLevels() |
| `getPrice` | Yahoo Finance single quote |
| `savePrice` | DataAgent.savePrice() |
| `searchTicker` | Yahoo Finance search |
| `testTelegram` | send test message |

## Market data sources (DataAgent)

| Asset | Yahoo Finance symbol | Stored as |
|---|---|---|
| Gold (spot) | `XAUUSD=X` | `XAU` |
| S&P 500 | `^GSPC` | `SP500` |
| SET Index | `^SET.BK` | `SET` |
| USD/THB | `THB=X` | `USDTHB` |
| Crypto | CoinGecko API | coin symbol |
| Thai MF NAVs | AIMC scrape | fund code |

---

## Frontend state

```js
// state object (global)
state.userId        // UUID of logged-in user
state.partnerId     // UUID of partner
state.currency      // 'USD' | 'THB'
state.usdThb        // current rate
state.fxRates       // { [currency]: rate vs THB }
state.gasUrl        // GAS web app URL
state.cache         // price cache { [symbol]: price }
state.charts        // Chart.js instances { [canvasId]: chart }

// loose globals
_portTableData      // precomputed holdings rows for current tab
_sortState          // { col, dir }
_dbCache            // { my, partner } — calcUserData results for home donut
_dbDonutMode        // 'me' | 'combined'
_cashEditId         // cash modal: null = add, uuid = edit
_cashSelectedBank   // bank code in cash modal
_cashType           // 'saving' | 'fixed_deposit' | 'fcd'
_cashFdStatus       // 'active' | 'matured'
_goldEditId         // gold modal: null = add, uuid = edit
```

## Pages / navigation

6-tab bottom nav: **Home · US · Cash · Asset · Analysis · Settings**

`navigate(page)` → `loadPage(page)` dispatches to the loader function.

```
dashboard     Home — net worth, Me/Combined toggle, donut, asset cards
us            US Portfolio — combined metric cards, tab per portfolio, holdings table
gold          Gold — metric cards, S/R bar, holdings table, add/edit modal
cash          Cash — total summary card, grouped by type (Savings/FD/FCD)
mf            Mutual Funds — filter by category
insurance     Insurance policies
private       Private investments
dca           DCA plan approval
monthly       Monthly Review — trigger generateDCA
weekly        Weekly Review — trigger analyzeAll
allportfolio  All Portfolio — read-only AI signals across all holdings
settings      Theme, profile, Telegram, GAS URL
partner       Partner view (no nav entry; navigate('partner') directly)
```

Nav highlight logic:
- `nav-analysis` → analysis, monthly, weekly, allportfolio, dca
- `nav-more` → gold, mf, insurance, private
- `nav-cash` → cash
- others → `nav-${page}`

## Key functions

### Home dashboard
- `loadDashboard()` — parallel fetch both users, renders hero + user cards + donut + asset grid
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], cashUSD, cashBreakdown, goldUSD, mfUSD, privateUSD, insuranceUSD, cryptoUSD, otherUSD }`
- `switchDonutMode('me'|'combined')` — re-renders donut from `_dbCache` without re-fetching
- `_renderAssetSummary(segments, totalUSD)` — 2-column card grid below donut

### US Portfolio
- `loadUSPortfolio()` — builds tabs + calls `_computeUSCombinedMetrics` and `loadPortfolioTab` in parallel
- `_computeUSCombinedMetrics(portfolios)` — fetches all holdings + prev-day prices, returns combined value/PL/dayChange
- `loadPortfolioTab(portfolioId, tabBtn)` — fetches holdings + prices + prev prices + analyses; renders stats bar + table
- Stats bar includes: Value · Cost · P/L · 1D Change · N positions

### Gold
- `loadGold()` — fetches holdings + XAU price + prev-day price + sr_levels for XAU; renders metric cards + S/R bar + table
- Gold S/R comes from `sr_levels` table (`ticker='XAU'`) — populated when GAS `updateSRLevels` runs
- `openAddGold()` / `openEditGold(id)` / `saveGold()` / `deleteGold(id)`
- `calcGoldTotal()` — auto-computes total cost (oz × avg cost) in modal

### Cash
- `loadCash()` — shows total summary card (grouped by sub_type) above account sections
- `balance` column is always THB principal for all account types
- FCD: `balance = fcd_amount × fcd_purchase_rate`

## CSS design system

```css
/* Dark theme (default via html.dark) */
--bg: #06070a
--surface: #0d0f14
--surface2: #13161e
--border: rgba(255,255,255,.07)
--text: #e2e6f0
--text-muted: #5a6278
--success: #16a34a   --danger: #dc2626   --warning: #d97706
--accent: #4f9eff (dark)
```

Key classes:
- `.card` / `.card2` — primary / secondary card
- `.g2x` / `.g4x` — 2 or 4-column grid
- `.m-lbl` / `.m-val` / `.m-sub` — metric label/value/subtitle (body font)
- `.mono` — JetBrains Mono (table numbers only)
- `.pt-table` / `.pt-mono` / `.pt-ticker` — portfolio table cells
- `.pt-sr` / `.pt-sr-s` / `.pt-sr-r` — S/R level display
- `.gc` / `.rc` / `.ac` — green/red/amber color utilities
- `.b-buy` / `.b-sell` / `.b-hold` / `.b-trim` / `.b-dca` — signal badges
- `.currency-toggle` / `.currency-btn` — USD/THB toggle buttons
- `setCurrency(c)` reloads the current page via `loadPage(state.currentPage)`

## Thai bank config

`THAI_BANKS` embedded inline in `index.html` (19 banks). Helper: `_bankLogoImg(code, size)` → `<img>` with circular crop + brand-color border. Logos in `assets/banks/{CODE}.png`.

## Service worker

Cache name: **`smart-me-v24`**. Bump on every `index.html` change.

Strategy:
- Network-first: Supabase API, `index.html` / app root (ensures updates always show)
- Cache-first: CDN assets (Chart.js, Supabase JS)
- Precached: CDN bundles only (not the app shell)

## What's NOT implemented (schema exists, no UI)

- Crypto holdings (`crypto_holdings` table)
- Thai bonds (`thai_bonds` table)
- Watchlist UI (`watchlist` table)
- Partner View (accessible via `navigate('partner')` only — no nav entry)
