# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks/ETFs, gold, cash (savings/FD/FCD), insurance, private investments, and Thai bonds. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

> **Mutual Funds — Phase 1 rebuilt 2026-06-20** — insert-only holdings with a manual `current_nav_thb` field; no external API, saving never blocks. Phase 2 (optional GAS auto NAV refresh) not yet built. See **"Mutual Funds — rebuild plan"** at the bottom of this file.

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
| PWA | `manifest.json` + `sw.js` (cache `smart-me-v44`) |

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
| `cash_accounts` | id, user_id, name, sub_type (`saving`/`fixed_deposit`/`fcd`), bank, balance (always THB), currency, interest_rate, start/maturity_date, fcd_amount, fcd_purchase_rate |
| `insurance_policies` | id, user_id, policy_name, annual_premium_thb, surrender_value_thb |
| `private_investments` | id, user_id, name, current_valuation, currency |
| `crypto_holdings` | id, user_id, coin_id, symbol, quantity, avg_cost_usd *(schema only, no UI)* |
| `mutual_fund_holdings` | id, user_id, fund_name NOT NULL, category (`Onshore`/`Offshore`/`RMF`/`ESG`/`SSF`/`Other`), units, avg_cost_thb (cost/unit), current_nav_thb *(nullable, manual)*, nav_updated_at *(nullable)*, buy_date, notes, created_at — Phase 1: manual NAV only, no external fetch |
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
- Frontend (anon key) can write: `holdings`, `portfolios`, `watchlist`, `cash_accounts`, `gold_holdings`, `dca_plan_items`, `private_investments`, `thai_bonds`, `mutual_fund_holdings`
- `bond_master` is read-only for anon; GAS writes it via service_role
- GAS uses `service_role` key (bypasses RLS entirely)

### Migrations applied (001–013 ✓; **014 pending — run in Supabase SQL editor**)
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
     create mutual_fund_master + mutual_fund_nav tables  [superseded by 013]
012  mutual_fund_holdings.fund_code: DROP NOT NULL (fund code now matched in background)  [superseded by 013]
013  DROP mutual_fund_nav + mutual_fund_holdings + mutual_fund_master (MF feature removed, rebuild fresh)
014  mutual_fund_holdings recreated (Phase 1): insert-only, manual current_nav_thb, anon RW RLS
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

## Market data sources (DataAgent)

| Asset | Source | Stored as |
|---|---|---|
| Gold (spot) | Stooq.com CSV → GLD ETF÷0.093252 → goldprice.org → metals.live | `XAU` in `market_data` |
| S&P 500 | Yahoo Finance `^GSPC` | `SP500` in `market_data` |
| SET Index | Yahoo Finance `^SET.BK` | `SET` in `market_data` |
| USD/THB | Yahoo Finance `THB=X` | `USDTHB` in `exchange_rates` |
| Crypto | CoinGecko API | coin symbol in `market_data` |
| Thai bond info | ThaiBMA EN website scrape (cached in `bond_master`) | — |

> Thai Mutual Fund NAV fetching (SEC Open Data API + scrapers) was removed 2026-06-19. See **"Mutual Funds — rebuild plan"** at the bottom for prior findings and the fresh-start design.

**Gold price chain** (`_fetchGoldSpotPrice()` in DataAgent.gs): each source logs its HTTP code + raw body to the GAS execution log for diagnosis. Yahoo Finance forex symbols (`XAUUSD=X`) are unreliable from GAS server IPs — equity/ETF prices (GLD) are used instead as fallback.

**Standalone tests** — run from GAS IDE:
- `testGoldPrice()`, `testBondScrape()` — existing

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
mf            Mutual Funds — hero total + P/L, sort bar, expandable fund cards, manual NAV (Update NAV modal)
cash          Cash — total summary card, grouped by type (Savings/FD/FCD)
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
- `nav-more` → gold, **mf**, insurance, private, **bonds**
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

### Mutual Funds (Phase 1 — manual NAV, no external calls)
- `loadMutualFunds()` → `_loadMutualFundsInner(el)` — fetches `mutual_fund_holdings`, computes per-holding value/cost/PL, renders hero + sort bar + expandable fund cards. All THB. Wrapped in try/catch (errors only toast, never crash).
- Per holding: `costValue = units × avg_cost_thb`; value uses `current_nav_thb` when set, **else falls back to cost basis** (so a fund with no NAV still counts toward net worth but shows P/L `—`).
- `_renderMFHero(latestTs)` / `_renderMFList()` / `setMFSort(key)` / `toggleMFExpand(id)` / `_mfCatStyle(cat)`
- Modal: Buy/Sell type toggle (Sell reserved for future tx history — saving still records a holding), free-text fund name with local `<datalist>` autocomplete (NOT an API call), category pills (Onshore/Offshore/RMF/ESG/SSF/Other), 3 input methods (Total Baht / Total Units / Manual) reusing `_numInputFmt`/`_parseNum`, optional Current NAV, collapsible notes.
- `openAddMF()` / `openEditMF(id)` / `saveMF()` / `deleteMF(id)` / `_deleteMFFromModal()` — `saveMF()` is a pure DB insert/update; **never awaits a GAS/external call**.
- `openMFNavModal(id, name)` / `saveMFNav()` — "Update NAV" button edits `current_nav_thb` + `nav_updated_at` only.
- Globals: `_mfListData`, `_mfEditId`, `_mfSortKey`, `_mfExpandedId`, `_mfCategory`, `_mfInputMethod`, `_mfType`, `_mfNavId`.

### Cash
- `loadCash()` — shows total summary card (grouped by sub_type) above account sections
- `balance` column is always THB principal for all account types
- FCD: `balance = fcd_amount × fcd_purchase_rate`

### Asset hub (More page)
- `loadMore()` — fetches live THB values for all 4 asset types in parallel, renders each row as: icon + name | ฿value + % of subtotal | ›
- % is share of the four-asset subtotal (gold + insurance + private + bonds), not total portfolio

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

Cache name: **`smart-me-v44`**. Bump on every `index.html` change.

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

## What's NOT implemented (schema exists, no UI)

- Crypto holdings (`crypto_holdings` table)
- Watchlist UI (`watchlist` table)
- Partner View (accessible via `navigate('partner')` only — no nav entry)

---

## Mutual Funds — rebuild plan (fresh start, drafted 2026-06-19)

The previous MF implementation was removed because two things kept breaking:
1. **Keying in a new fund threw errors.** Saving a holding was coupled to an external NAV/code lookup. If the SEC API call failed, returned 400, or the fund wasn't found, the save flow surfaced the error. PostgREST also crashed on `.in([null])` when a holding had no `fund_code`.
2. **NAV fetching never worked reliably.** The SEC Open Data v2 API has **no per-fund filter** — finding one fund meant paginating all ~11 500 funds via `?next_cursor=`. The real target fund (KKOREPATH / KKP CorePath Balanced) was not even present in the API, and every scraper fallback (thaifundstoday, finnomena, Morningstar, KKP site) was client-rendered, 404, or IP-blocked from GAS.

### Core principle for the rebuild
**Adding a holding must never call an external API and must never block on NAV.** Saving a fund = a pure DB insert of what the user typed. NAV is a *separate, optional, never-fatal* layer. This alone eliminates the "error when I key in a new fund" class of bugs.

### Recommended approach: manual-NAV-first, automation optional
Treat MF like the bond/private pages — the user owns the numbers; automation is a convenience that can fail silently.

**Phase 1 — holdings + manual NAV (no external calls, ships clean) — ✅ DONE 2026-06-20**
> Built exactly as specced below: migration 014 recreated `mutual_fund_holdings` (insert-only, manual `current_nav_thb`), MF page + add/edit/delete modal + "Update NAV" modal, and `mfUSD`/`mfTHB` re-wired into `calcUserData`, donut `_seg`, "Other" card, `loadMore`, and partner view. Funds with no NAV fall back to cost basis for value and show P/L `—`. (Also fixed a pre-existing bug: `addUSD`/`combUsPort` were referenced but undefined in `loadDashboard`, silently breaking the home 2×2 category cards.) **Migration 014 must be run in Supabase before the page works.**

1. **Migration 014** — recreate tables, simpler than before:
   - `mutual_fund_holdings`: `id, user_id, fund_name NOT NULL, category, units, avg_cost_thb, current_nav_thb (nullable), nav_updated_at (nullable), buy_date, notes, created_at timestamptz DEFAULT now()`. **No `fund_code` requirement.** Add the `created_at` column this time.
   - Skip `mutual_fund_master` / `mutual_fund_nav` entirely for Phase 1 — store the latest NAV directly on the holding (`current_nav_thb`). Add a history table only if a 1-day-change badge is actually wanted later.
   - RLS: anon read + anon insert/update/delete (same pattern as `thai_bonds`).
2. **MF page + modal** — add/edit/delete a fund: name, category, units, avg cost, and an editable **Current NAV (THB)** field the user can type. Value = `units × current_nav_thb`. P/L = vs `units × avg_cost_thb`.
3. **Wire back into dashboard/asset-hub** — re-add `mfUSD` to `calcUserData()`, the home donut (`_seg`), the "Other" card, `loadMore()`, and partner view. (Search this file's git history for the removed lines — they show exactly where each `mfUSD`/`mfTHB` line went.)
4. Result: fully working MF tracking with zero error surface, because nothing leaves the browser except Supabase writes.

**Phase 2 — optional automated NAV refresh (additive, never blocks saves)**
- Add a single GAS action `refreshMFNav` run by the daily trigger and a manual "Refresh NAV" button. It updates `current_nav_thb` + `nav_updated_at` and **swallows all errors** (logs only) — a failed refresh never affects the holding or the UI.
- **Pick the NAV source deliberately before coding.** Validate it with a throwaay `UrlFetchApp` test in the GAS IDE first — confirm it returns JSON (not client-rendered HTML) and isn't IP-blocked from Google's servers. Candidates, in rough order of reliability:
  1. **SEC Open Data v2** `GET /v2/fund/daily-info/nav?proj_id={id}` — works *only* if the fund exists in SEC and you have its `proj_id`. Have the **user paste the SEC `proj_id` once** (store on the holding) instead of paginating 11 500 funds to discover it. Confirm the held funds are actually in SEC first.
  2. **AMC / settrade / wealthmagik JSON endpoints** — check whether the specific AMCs (e.g. KKP) expose a JSON NAV endpoint.
  3. **Manual only** — if no reliable source exists for a given fund, leave it manual. That's an acceptable end state, not a failure.
- Do **not** reintroduce: blind pagination of the whole SEC catalogue, name→code fuzzy matching, or HTML scraping of Next.js client-rendered pages. Those were the unreliable parts.

### Hard rules carried over from the failure
- `getLatestPrice()` / any `.in(...)` PostgREST query must filter out null ids **before** the call.
- The "Add Fund" button must never `await` a GAS call. Save first, return to the list, *then* (optionally) kick a fire-and-forget refresh.
- Every external fetch in GAS uses `muteHttpExceptions: true` and is wrapped so it can only log, never throw into a user path.

### Deploy steps when implementing
1. Run migration 014 in Supabase SQL editor (save the file to `supabase/migrations/` first).
2. Build the page following `skills/add-asset-page.md`.
3. If doing Phase 2, paste updated GAS into the Apps Script IDE and redeploy the Web App (see `skills/deploy-gas.md`).
4. Bump `sw.js` cache version.
