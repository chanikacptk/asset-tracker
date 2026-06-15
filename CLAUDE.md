# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks/ETFs, gold, Thai mutual funds, cash (savings/FD/FCD), insurance, private investments, and Thai bonds. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`, ~5 700 lines) — vanilla JS, no build step |
| Fonts | Instrument Sans (body + titles), Syne (tickers only), JetBrains Mono (table numbers only) — **do not change** |
| Styling | CSS variables, dark/light via `html.dark` (default: dark) |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot (per-user chat IDs) |
| PWA | `manifest.json` + `sw.js` (cache `smart-me-v39`) |

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
index.html              Main app — all HTML/CSS/JS (~5 700 lines)
sw.js                   Service worker (cache-first CDN, network-first app shell)
manifest.json           PWA manifest
portfolio_tracker.html  Design reference — NOT the active app

gas/
  Code.gs               Orchestrator, doGet entry, trigger setup
  Config.gs             Script Properties wrapper
  DataAgent.gs          Market data: Yahoo Finance, CoinGecko, SEC Open Data NAV, S/R levels + bond scraper
  AnalystAgent.gs       Claude API → BUY/SELL/HOLD/TRIM signals
  DCAAgent.gs           Monthly DCA plan generation
  NewsAgent.gs          NewsAPI.org fetching
  NotificationAgent.gs  Telegram: daily/weekly/breaking/realtime alerts
  ScriptProperties.md   GAS secrets setup guide

supabase/
  schema.sql            Full schema (bootstrap once)
  seed.sql              Sample data
  migrations/           012 migrations — all applied ✓

skills/
  add-asset-page.md     Pattern for adding new asset pages
  debug-price-fetch.md  Checklist for debugging wrong/zero price issues
  deploy-gas.md         Steps for updating and redeploying GAS
  supabase-migration.md Template for adding new tables with RLS
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
| `mutual_fund_holdings` | id, user_id, fund_code (nullable), fund_name, category (`Onshore`/`Offshore`/`RMF`/`ESG`/`SSF`), units, buy_price_thb, buy_date, notes |
| `mutual_fund_master` | fund_code PK, fund_name, fund_name_th, category, amc, sec_proj_id, scraped_at — SEC API cache |
| `mutual_fund_nav` | id, fund_code, nav_date, nav_price — daily NAV history, UNIQUE(fund_code, nav_date) |
| `cash_accounts` | id, user_id, name, sub_type (`saving`/`fixed_deposit`/`fcd`), bank, balance (always THB), currency, interest_rate, start/maturity_date, fcd_amount, fcd_purchase_rate |
| `insurance_policies` | id, user_id, policy_name, annual_premium_thb, surrender_value_thb |
| `private_investments` | id, user_id, name, current_valuation, currency |
| `crypto_holdings` | id, user_id, coin_id, symbol, quantity, avg_cost_usd *(schema only, no UI)* |
| `thai_bonds` | id, user_id, bond_name NOT NULL, bond_code, credit_rating, face_value_thb, units, coupon_rate, coupon_type, issued_date, maturity_date, purchase_date, purchase_price_thb, price_per_unit_thb, notes |
| `bond_master` | bond_code PK, bond_name, issuer, credit_rating, coupon_rate, coupon_type, issued_date, maturity_date, scraped_at — ThaiBMA scrape cache |

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
- Frontend (anon key) can write: `holdings`, `portfolios`, `watchlist`, `cash_accounts`, `gold_holdings`, `dca_plan_items`, `private_investments`, `mutual_fund_holdings`, `thai_bonds`
- `bond_master`, `mutual_fund_master`, `mutual_fund_nav` are read-only for anon; GAS writes them via service_role
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
009  RLS FORCE + ENABLE on all tables + app_config write lockdown
010  thai_bonds extended columns + bond_master cache table + write RLS
011  mutual_fund_holdings: add notes, expand category CHECK (→ Onshore/Offshore/RMF/ESG/SSF),
     create mutual_fund_master + mutual_fund_nav tables
012  mutual_fund_holdings.fund_code: DROP NOT NULL (fund code now matched in background)
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
| `SEC_API_KEY` | SEC Open Data subscription key (secopendata.sec.or.th → กองทุน section) |

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
| `getGoldPrice` | DataAgent.fetchGoldPrice() — live spot, saves to DB, returns `{price, source}` |
| `savePrice` | DataAgent.savePrice() |
| `searchTicker` | Yahoo Finance search |
| `testTelegram` | send test message |
| `scrapeBondInfo` | DataAgent.scrapeBondInfo(bondCode) — scrapes ThaiBMA, caches in bond_master |
| `fetchThaiMutualFunds` | DataAgent.fetchThaiMutualFunds() — fetch NAV for all held funds from SEC API |
| `matchMFFund` | DataAgent.matchSECFundByName(fundName) — name→code match, updates holding + fetches NAV immediately. Params: `fundName`, `holdingId` |

## Market data sources (DataAgent)

| Asset | Source | Stored as |
|---|---|---|
| Gold (spot) | Stooq.com CSV → GLD ETF÷0.093252 → goldprice.org → metals.live | `XAU` in `market_data` |
| S&P 500 | Yahoo Finance `^GSPC` | `SP500` in `market_data` |
| SET Index | Yahoo Finance `^SET.BK` | `SET` in `market_data` |
| USD/THB | Yahoo Finance `THB=X` | `USDTHB` in `exchange_rates` |
| Crypto | CoinGecko API | coin symbol in `market_data` |
| Thai MF NAVs | SEC Open Data v2 API → thaifundstoday.com fallback | fund code in `market_data` + `mutual_fund_nav` |
| Thai bond info | ThaiBMA EN website scrape (cached in `bond_master`) | — |

**SEC Open Data MF NAV chain** (`_fetchSECNav()` in DataAgent.gs):
1. `GET /v2/fund/daily-info/nav?proj_abbr_name={code}` — direct by abbreviation (fastest)
2. `GET /v2/fund/general-info/profiles?proj_abbr_name={code}` — fetch projId, cache in `mutual_fund_master`
3. `GET /v2/fund/daily-info/nav?proj_id={projId}` — retry by projId
4. Scrape `thaifundstoday.com/funds/{code}` — HTML fallback

Auth header: `Ocp-Apim-Subscription-Key: {SEC_API_KEY}`. Both snake_case and camelCase field names are handled via `||` fallbacks.

NAV is written to both `market_data` (backwards-compat for dashboard/loadMore/calcUserData) and `mutual_fund_nav` (history for 1-day change).

**MF name→code matching** (`matchSECFundByName()` in DataAgent.gs):
- Called after user saves a new fund holding (via `matchMFFund` GAS action)
- Tries `/v2/fund/general-info/funds?fund_name=`, then `/profiles?proj_name_en=`, then `proj_name_th=`, then `proj_abbr_name=`
- Picks best match (name contains search term), caches in `mutual_fund_master`
- On match: updates `mutual_fund_holdings.fund_code` + calls `fetchNavForSingleFund()` immediately

**Gold price chain** (`_fetchGoldSpotPrice()` in DataAgent.gs): each source logs its HTTP code + raw body to the GAS execution log for diagnosis. Yahoo Finance forex symbols (`XAUUSD=X`) are unreliable from GAS server IPs — equity/ETF prices (GLD) are used instead as fallback.

**Standalone tests** — run from GAS IDE:
- `testGoldPrice()`, `testBondScrape()` — existing
- `testSECApi()` — hits all 3 SEC v2 endpoints, logs raw response (use to verify field names)
- `testFetchThaiMutualFunds()` — full NAV fetch + upsert for all held funds
- `testMatchMFFund()` — name→code match for a hardcoded test fund name

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
_mfListData         // computed MF holdings array (with currentNav, plPct, etc.)
_mfEditId           // MF modal: null = add, uuid = edit
_mfSortKey          // 'value_desc' | 'value_asc' | 'pl_desc' | 'name_asc'
_mfExpandedId       // ID of currently expanded MF card (null = all collapsed)
_mfCategory         // selected category in MF modal
_mfInputMethod      // 'baht' | 'units' | 'manual'
_mfLinkId           // holding being linked in link modal
_mfLinkName         // fund name for the link modal
_bondEditId         // bond modal: null = add, uuid = edit
_bondInputMethod    // 'baht' | 'units' | 'manual'
_bondListData       // cached bond array for list/sort/search
_selectedBondId     // currently selected bond in master-detail view
_bondSortKey        // 'code' | 'maturity' | 'amount' | 'coupon'
```

## Pages / navigation

6-tab bottom nav: **Home · US · Cash · Asset · Analysis · Settings**

`navigate(page)` → `loadPage(page)` dispatches to the loader function.

```
dashboard     Home — net worth, Me/Combined toggle, donut, asset cards
us            US Portfolio — combined metric cards, tab per portfolio, holdings table
gold          Gold — metric cards, S/R bar, holdings table, add/edit modal
cash          Cash — total summary card, grouped by type (Savings/FD/FCD)
mf            Mutual Funds — KKP-style cards, hero summary, sort dropdown, expand/collapse details
insurance     Insurance policies
private       Private investments
bonds         Thai Bonds — KPI cards, 2 donut charts, master-detail list
dca           DCA plan approval
monthly       Monthly Review — trigger generateDCA
weekly        Weekly Review — trigger analyzeAll
allportfolio  All Portfolio — read-only AI signals across all holdings
settings      Theme, profile, Telegram, GAS URL
partner       Partner view (no nav entry; navigate('partner') directly)
```

Nav highlight logic:
- `nav-analysis` → analysis, monthly, weekly, allportfolio, dca
- `nav-more` → gold, mf, insurance, private, **bonds**
- `nav-cash` → cash
- others → `nav-${page}`

## Key functions

### Home dashboard
- `loadDashboard()` — parallel fetch both users, renders hero + user cards + donut + asset grid
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], cashUSD, cashBreakdown, goldUSD, mfUSD, privateUSD, insuranceUSD, bondsUSD, cryptoUSD, otherUSD }`
- `switchDonutMode('me'|'combined')` — re-renders donut from `_dbCache` without re-fetching
- `_renderAssetSummary(segments, totalUSD)` — 2-column card grid below donut

### US Portfolio
- `loadUSPortfolio()` — builds tabs + calls `_computeUSCombinedMetrics` and `loadPortfolioTab` in parallel
- `_computeUSCombinedMetrics(portfolios)` — fetches all holdings + prev-day prices, returns combined value/PL/dayChange
- `loadPortfolioTab(portfolioId, tabBtn)` — fetches holdings + prices + prev prices + analyses; renders stats bar + table
- Stats bar includes: Value · Cost · P/L · 1D Change · N positions

### Gold
- `loadGold(_liveRefreshed?)` — fetches holdings + XAU price (DB cache) + prev-day price + sr_levels; renders metric cards + S/R bar + table. After render, fires `callGAS('getGoldPrice')` in background; if live price differs >0.1% from cached, updates `state.cache['XAU']` and re-renders once with `_liveRefreshed=true` to prevent loop.
- Gold S/R comes from `sr_levels` table (`ticker='XAU'`) — populated when GAS `updateSRLevels` runs
- `openAddGold()` / `openEditGold(id)` / `saveGold()` / `deleteGold(id)`
- `calcGoldTotal()` — auto-computes total cost (oz × avg cost) in modal

### Cash
- `loadCash()` — shows total summary card (grouped by sub_type) above account sections
- `balance` column is always THB principal for all account types
- FCD: `balance = fcd_amount × fcd_purchase_rate`

### Asset hub (More page)
- `loadMore()` — fetches live THB values for all 5 asset types in parallel, renders each row as: icon + name | ฿value + % of subtotal | ›
- % is share of the five-asset subtotal (gold + insurance + private + MF + bonds), not total portfolio

### Mutual Funds
- `loadMutualFunds()` — fetches holdings, batch-fetches NAV from `mutual_fund_nav` (linked funds only, skips null fund_code to avoid PostgREST `.in([null])` crash), falls back to `market_data`, renders hero + sort + cards
- `_loadMutualFundsInner(el)` — inner implementation wrapped by try-catch; DB error surfaced as toast
- `_renderMFHero(latestDate)` — total value + P/L hero card with decimal split display
- `_renderMFList()` — sorts `_mfListData`, renders KKP-style expandable cards
- Card shows: category badge, 🟢/🟡 NAV status badge, 1D change badge (linked only), fund name bold, fund code mono subtitle, current value, P/L arrow + % + THB
- `toggleMFExpand(id)` — expand/collapse detail section (cost value, units, market price, cost/unit, fund code, profile/link button)
- `setMFSort(key)` — re-sorts without re-fetching
- `_mfCatStyle(cat)` — returns inline CSS for category badge colour (Onshore=blue, Offshore=orange, RMF=purple, ESG=green, SSF=amber)
- `openAddMF()` / `openEditMF(id)` / `closeMFModal()` / `saveMF()` / `deleteMF(id)` / `_deleteMFFromModal()`
- `saveMF()`: validates fund name (required) + category + cost/unit + units; inserts WITHOUT fund_code; shows success toast; calls `_triggerMFNameMatch()` in background
- `_triggerMFNameMatch(holdingId, fundName)` — calls GAS `matchMFFund`; on match refreshes list to show green badge
- `openMFLinkModal(id, name)` / `closeMFLinkModal()` — link modal for unlinked funds
- `autoMatchMFFund()` — calls GAS `matchMFFund`, closes modal + refreshes on success
- `manualLinkMFFund()` — writes fund_code directly to DB, triggers `fetchThaiMutualFunds` GAS action
- **`mutual_fund_holdings.buy_date` is used for sort order** — table has no `created_at` column

### Thai Bonds
- `loadBonds()` — fetches holdings, renders KPI cards → donut dashboard → 90d alert → bond list
- KPI cards: Total Invested (full-width), Next Coupon (with bond code), Avg. Coupon %
- **Portfolio dashboard**: 2 side-by-side donuts — Allocation by bond, Maturity distribution (< 90d / 90d–1yr / 1–3yr / >3yr); uses existing Chart.js `centerText` plugin
- **Master-detail layout**: sort bar (Code A→Z / Maturity ↑ / Amount ↓ / Coupon ↓) + search, tap bond → detail panel, "‹ All Bonds" back button
- `_renderBondSummary(bonds)` / `_renderBondDashboard(bonds)` / `_renderBondMaturingAlert(bonds)` / `_renderBondList(bonds, query)`
- `setBondSort(key)` — updates `_bondSortKey`, re-sorts live list
- `selectBond(id)` / `closeBondDetail()` — master-detail navigation
- `lookupBond()` — calls GAS `scrapeBondInfo`, pre-fills modal fields
- Modal: 3 input methods (Total Baht → auto-units, Total Units → auto-baht, Manual); all numeric inputs use `_numInputFmt(el)` for thousand separators; reads use `_parseNum(str)` to strip commas
- `openAddBond()` / `openEditBond(id)` / `saveBond()` / `deleteBond(id)`
- Bond helpers: `_ratingColor(rating)`, `_nextCouponDate(issued, maturity, type)`, `_couponPerPayment(face, rate, type)`, `_fmtShortDate(dateStr)`, `_daysTo(dateStr)`
- `bond_name NOT NULL` — `saveBond()` falls back to `bondCode` then `'(unnamed)'` so the constraint is never violated

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
- `.bond-kpi-card` / `.bond-kpi-val` / `.bond-kpi-lbl` — Bond KPI summary cards
- `.bond-chart-card` / `.bond-chart-wrap` — Bond donut chart containers
- `.bond-list-item` / `.bond-list-item.active` — Bond master list rows
- `.bond-detail-card` / `.bond-detail-grid` / `.bond-detail-box` — Bond detail view
- `.bond-rating-badge` — inline pill badge, color set via inline style from `_ratingColor()`
- `.bond-back-btn` — "‹ All Bonds" back button in detail panel
- `.more-val-slot` / `.more-val-num` / `.more-val-pct` — Asset page row value/% display

## Thai bank config

`THAI_BANKS` embedded inline in `index.html` (19 banks). Helper: `_bankLogoImg(code, size)` → `<img>` with circular crop + brand-color border. Logos in `assets/banks/{CODE}.png`.

## Service worker

Cache name: **`smart-me-v39`**. Bump on every `index.html` change.

Strategy:
- Network-first: Supabase API, `index.html` / app root (ensures updates always show)
- Cache-first: CDN assets (Chart.js, Supabase JS)
- Precached: CDN bundles only (not the app shell)

## Skills

Project-specific how-to guides in `skills/`:
- `add-asset-page.md` — full pattern for adding a new asset page (HTML → routes → CRUD → migration)
- `debug-price-fetch.md` — 7-step checklist for wrong/zero/stale price issues
- `deploy-gas.md` — updating GAS files, redeploying web app, trigger management
- `supabase-migration.md` — migration template, RLS boilerplate, checklist, PIN-auth caveat

## CSS additions (2026-06-15 session)

MF-specific classes:
- `.mf-hero` / `.mf-hero-header` / `.mf-hero-lbl` / `.mf-hero-ts` / `.mf-hero-total` / `.mf-hero-dec` / `.mf-hero-pl` — hero summary card
- `.mf-sort-select` — pill-style sort dropdown (SVG chevron via background-image)
- `.mf-fund-card` / `.mf-card-head` / `.mf-card-left` / `.mf-card-right` / `.mf-card-badges` — fund card layout
- `.mf-cat-badge` — category colour pill (inline style from `_mfCatStyle()`)
- `.mf-card-code` / `.mf-card-name` / `.mf-card-value` / `.mf-card-pl` / `.mf-card-chevron` — card typography
- `.mf-card-detail` / `.mf-detail-row` / `.mf-detail-lbl` / `.mf-detail-val` / `.mf-detail-actions` — expandable section
- `.mf-profile-btn` — "View fund profile →" / "Link fund code →" button
- `.mf-cat-pill` / `.mf-cat-pill.active` — category pills in add/edit modal
- `.mf-nav-badge.linked` (green) / `.mf-nav-badge.unlinked` (orange, tappable) — NAV link status

---

## What's NOT implemented (schema exists, no UI)

- Crypto holdings (`crypto_holdings` table)
- Watchlist UI (`watchlist` table)
- Partner View (accessible via `navigate('partner')` only — no nav entry)

---

## What's left to do (Mutual Fund page)

### Needs verification / testing
- **`testSECApi()`** — run from GAS IDE to confirm SEC API field names match what `_secParseNavEntry` and `_secFetchProfile` expect. If field names differ, update the `||` chains in those functions.
- **`testMatchMFFund()`** — run with a real fund name you hold (edit the hardcoded name in Code.gs first). Confirm `match.fundCode` is returned and `mutual_fund_nav` gets a row.
- **Daily 8 AM trigger** — `fetchThaiMutualFunds()` is called inside `DataAgent.fetchAll()` which is called by `onDailyTrigger`. Verify NAV rows appear in `mutual_fund_nav` the next morning.

### Known gaps
- **`mutual_fund_holdings` has no `created_at` column** — list is ordered by `buy_date` instead. Consider adding `created_at timestamptz DEFAULT now()` in a future migration 013 if insertion-order display matters.
- **1-day change requires 2 consecutive days of NAV data** — the badge won't appear until the daily trigger has run on two separate days.
- **Background name match only fires on new adds** — editing an existing unlinked holding does not re-trigger the SEC search. User must tap the 🟡 badge to link manually.
- **`mutual_fund_holdings` has no `created_at`** — the background match query after save uses `.is('fund_code', null).order('buy_date', desc)` to find the just-inserted row, which is fragile if the user adds two funds on the same day with no purchase date. Migration 013 should add `created_at`.
- **NAV on home dashboard / loadMore** — still reads from `market_data` via `getLatestPrice()`. Accurate only after GAS daily run populates `market_data`. No change needed — this is intentional for backwards-compat.
- **Partner view** — reads `mutual_fund_holdings` and uses `getLatestPrice()`. Works but won't show 1-day change (no access to `mutual_fund_nav` directly). Acceptable for now.
