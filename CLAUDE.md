# Smart Me — Asset Tracker

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks/ETFs, gold, cash (savings/FD/FCD), insurance, private investments, and Thai bonds. AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

> **Mutual Funds — fully rebuilt 2026-06-20** — Phase 1 (manual NAV, insert-only) + Phase 2 (daily auto-refresh) + fund-name search complete. See **"Mutual Funds — rebuild plan"** at the bottom.
> **NAV source order flipped 2026-06-25**: NAV refresh is now **Tier 1 Finnomena by `fund_code`** (freshest, no key, widest coverage) → **Tier 2 SEC by `sec_proj_id`** (official fallback) → Tier 3 manual. Also: adding a fund with an auto source now kicks a **fire-and-forget** NAV refresh so its card flips 🟡→🟢 within seconds instead of waiting for the 8PM trigger.
> **Daily Tech-News brief + Analysis page (2026-06-26)**: New holdings-aware morning brief — `NotificationAgent.sendDailyNewsBrief()` (7AM trigger `onNewsBriefTrigger`) uses Claude's **server-side `web_search` tool** to find today's tech/market news, flags stories about tickers the user holds with 🎯, sends via Telegram, and **persists** to `daily_news` + `daily_news_impact` (migration 021). The **Analysis tab** now reads those tables to show a browsable, sentiment-colored news history (date selector + 🎯 holdings / 📊 market sections), with the DCA/review hub kept below as "Tools". **Depth is decoupled**: Claude returns the full ~8-12 stories (all persisted to the page); Telegram is capped to a scannable top 6 with a "+N more" footer. See **"Daily Tech-News brief"** + **"Analysis"** sections.

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
| PWA | `manifest.json` + `sw.js` (cache `smart-me-v63`) |

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
  NotificationAgent.gs  Telegram: daily/weekly/breaking/realtime alerts + daily Tech-News brief
  ScriptProperties.md   GAS secrets setup guide

supabase/
  schema.sql            Full schema (bootstrap once)
  seed.sql              Sample data
  migrations/           017 migrations — 001–017 all applied ✓

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
| `private_investments` | id, user_id, name, current_valuation, currency *(legacy — superseded by `private_holdings`, no longer read by the app)* |
| `private_holdings` | id, user_id, inv_type (`company`/`govbond`), name NOT NULL, plan_name *(company only — plan within the company, e.g. "GET 1")*, principal_thb (always THB), rate_pct *(annual interest / coupon %)*, start_date *(investment/purchase date)*, term_value + term_unit (`months`/`years`, company only), maturity_date *(auto from start+term, editable)*, payout_freq *(`monthly`/`quarterly`/`semi-annually`/`annually`; null = lump sum at maturity)*, status (`active`/`matured`/`withdrawn`; govbond only uses active/matured), notes, created_at — backs the Private Investment page |
| `crypto_holdings` | id, user_id, coin_id, symbol, quantity, avg_cost_usd *(schema only, no UI)* |
| `mutual_fund_holdings` | id, user_id, fund_name NOT NULL, category (`Onshore`/`Offshore`/`RMF`/`ESG`/`SSF`/`Other`), units, avg_cost_thb (cost/unit), current_nav_thb *(nullable)*, nav_date *(nullable — source valuation date)*, nav_updated_at *(nullable — when we last polled)*, sec_proj_id *(nullable)*, sec_fund_class_name *(nullable — exact SEC class; one proj_id has many classes)*, fund_code *(nullable — plain code, e.g. ES-FIXEDRMF; primary Finnomena NAV key, tried before SEC)*, buy_date, notes, created_at |
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
| `daily_news` | id, user_id, news_date, emoji, ticker, headline, sentiment (`positive`/`negative`/`neutral`), is_holding_related, sources (jsonb array), sort_order, created_at — persisted daily Tech-News brief (per user), backs the Analysis page history |
| `daily_news_impact` | id, news_id (FK→daily_news), user_id, impact, created_at — per-user "ผลต่อ position" line for holdings-related stories |
| `notifications_log` | id, user_id, notification_type, sent_at |
| `alert_cooldowns` | id, user_id, ticker, alert_type, last_sent_at — unique on (user_id, ticker, alert_type) |
| `app_config` | key, value — stores `gas_web_app_url` |

### RLS pattern
- All tables: `anon_read_all` SELECT policy (frontend filters by `user_id` in JS)
- Frontend (anon key) can write: `holdings`, `portfolios`, `watchlist`, `cash_accounts`, `gold_holdings`, `dca_plan_items`, `private_investments`, `private_holdings`, `thai_bonds`, `mutual_fund_holdings`
- `bond_master`, `daily_news`, `daily_news_impact` are read-only for anon; GAS writes them via service_role
- GAS uses `service_role` key (bypasses RLS entirely)

### Migrations applied (001–017 ✓)
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
014  mutual_fund_holdings recreated (Phase 1): insert-only, manual current_nav_thb, anon RW RLS  ✓
015  mutual_fund_holdings.sec_proj_id + sec_fund_class_name (Phase 2): optional SEC link for daily NAV refresh  ✓
016  mutual_fund_holdings.nav_date: stores SEC valuation date separately from nav_updated_at (last-polled ts)  ✓
017  mutual_fund_holdings.fund_code: plain code (e.g. ES-FIXEDRMF) — primary Finnomena NAV key (tried before SEC)  ✓
018  private_holdings: new table (company / govbond investments) — backs the rebuilt Private Investment page; supersedes private_investments  ✓
019  private_holdings.plan_name: optional plan within a company (e.g. "GET 1"), company-only  ✓
020  private_holdings.payout_freq: interest/coupon payout schedule (monthly/quarterly/semi-annually/annually; null = lump sum at maturity) — drives Next Payout display  ✓
021  daily_news + daily_news_impact: persist the daily Tech-News brief (per user) so the Analysis page can show history; anon read-only, GAS service_role writes  ✓
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
- Daily @ 7AM → `onNewsBriefTrigger` (holdings-aware Tech-News brief via Claude `web_search` → Telegram; `atHour(7)` uses project TZ — set it to **Asia/Bangkok**)
- Daily @ 8AM → `onDailyTrigger` (weekdays: fetch → analyze → news → notify; monthly on day 1; weekly on Monday)
- Every 5 min → `onRealtimeTrigger` (crypto/gold ±5%, S/R proximity ±1%)
- Daily @ 8PM → `onMFNavTrigger` (mutual-fund NAV refresh; `atHour(20)` uses project TZ — set it to **Asia/Bangkok**)

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
| `sendNewsBrief` | NotificationAgent.sendDailyNewsBrief() — generates + sends the daily holdings-aware Tech-News brief now (manual trigger for testing) |
| `scrapeBondInfo` | DataAgent.scrapeBondInfo(bondCode) — scrapes ThaiBMA, caches in bond_master |
| `refreshMFNav` | DataAgent.refreshMFNav() — daily NAV refresh for MF holdings with an auto source. **Tiered**: Tier 1 Finnomena by `fund_code` (`_fetchFinnomenaNav`) → Tier 2 SEC by `sec_proj_id` (`_secNavForHolding`) → Tier 3 manual (untouched). Stores `current_nav_thb`, `nav_date` (source valuation date), `nav_updated_at`; returns `{checked, updated, skipped}`; never throws/overwrites manual NAV. Holdings query: `or=(sec_proj_id.not.is.null,fund_code.not.is.null)` |
| `mfLookupClasses` | DataAgent.lookupMFClasses(projId) — returns `[{fund_class_name, last_val, nav_date}]` for the "Find classes" picker |
| `mfSearchFunds` | DataAgent.lookupMFFunds(q) — searches SEC `/v2/fund/general-info/profiles?fund_class_name=` by (partial) name; returns `[{proj_id, fund_class_name, proj_name_en, amc_name}]`; partial matching works; user taps result to auto-fill `sec_proj_id` + class |

## Daily Tech-News brief (NotificationAgent)

Standalone morning notification, **separate from the portfolio reviews**. `sendDailyNewsBrief()` runs per user:
1. **Gather holdings** — `_getUserHoldingsForBrief(userId)`: US tickers (growth/dividend/etf via `portfolios`→`holdings`) drive 🎯 matching; Thai mutual-fund names passed as secondary awareness.
2. **Generate** — `_callClaudeWebSearch()` calls Claude (`claude-sonnet-4-6`) with the **server-side `web_search` tool** (`{type:'web_search_20250305', max_uses:6}`). One API call: the model runs its own searches for today's tech/market news and returns a JSON object `{holdings_stories[], market_stories[], sources[]}`. Stories about a held ticker go in `holdings_stories` (lead the brief); the rest in `market_stories`. Each summary is one line of Thai+English with concrete numbers + price reaction; holdings stories also get a one-line `impact` note. **Never fabricates** — every figure must come from a search result.
3. **Render + send** — `_renderNewsBrief()` builds the message and `_sendHtml()` sends it via Telegram with **`parse_mode: HTML`**. **Telegram is capped** (`_TG_MAX_TOTAL=6`, `_TG_MAX_HOLDINGS=4`: holdings lead, fill the rest with top market stories) to stay scannable, with a `+N more in the app → Analysis` footer. The model is prompted for the **full set** (~8-12 stories, ordered most-important-first); the cap only trims the chat — persistence (step 4) keeps everything, so the Analysis page shows them all. (not Markdown/MarkdownV2 — the brief is full of `$ % + - ( )` and Thai text that constantly break Markdown escaping; HTML only needs `& < >` escaped, done by `_escapeHtml`). Logged as `notification_type='news_brief'`.
4. **Persist** — `_persistNewsBrief(userId, data)` stores each story into `daily_news` (+ per-user impact into `daily_news_impact`) so the **Analysis page** can browse history. Idempotent per (user, news_date): deletes that day's rows first, then bulk-inserts (holdings rows first, so their ids map to impact rows). `_sentimentFromEmoji()` derives the card color bucket. Fully non-fatal — a DB error here never affects the Telegram send.

Visual format (matches the requested MarkdownV2 layout, rendered via HTML bold):
```
📰 Tech News Daily — 25 มิ.ย. 2569
━━━━━━━━━━━━━━━━━━
🎯 Related to your holdings:
🚀 $NVDA — <headline + numbers> (+X% AH)
   ↳ ผลต่อ position ของคุณ: ...
📊 Other market news:
📈 $SPX — <headline + numbers>
━━━━━━━━━━━━━━━━━━
ที่มา: Reuters · Bloomberg
```
- Trigger: `onNewsBriefTrigger` daily @ 7AM (project TZ Asia/Bangkok). Manual: web action `sendNewsBrief` or `testNewsBrief()` in the GAS IDE.
- Requires `CLAUDE_API_KEY` (web_search must be enabled for the org) + `TELEGRAM_BOT_TOKEN` — both already configured. No new Script Property.
- Fully non-fatal: per-user errors log & skip; a failed/empty brief sends nothing rather than a broken message.
- `_thaiDateLabel()` builds the Buddhist-era date deterministically (no locale dependency).
- **Robustness** (after a 2026-06-26 dropped-brief incident — one user truncated): `max_tokens` is **5000** (the full-set prompt was overflowing 3500 → truncated JSON → null), `_callClaudeWebSearch` logs when `stop_reason === 'max_tokens'`, and `sendDailyNewsBrief` **retries the call once** on null before giving up. The brief is generated **per user** (separate web_search call each), so one user failing never affects the other.

## Market data sources (DataAgent)

| Asset | Source | Stored as |
|---|---|---|
| Gold (spot) | Stooq.com CSV → GLD ETF÷0.093252 → goldprice.org → metals.live | `XAU` in `market_data` |
| S&P 500 | Yahoo Finance `^GSPC` | `SP500` in `market_data` |
| SET Index | Yahoo Finance `^SET.BK` | `SET` in `market_data` |
| USD/THB | Yahoo Finance `THB=X` | `USDTHB` in `exchange_rates` |
| Crypto | CoinGecko API | coin symbol in `market_data` |
| Thai bond info | ThaiBMA EN website scrape (cached in `bond_master`) | — |
| Mutual fund NAV (Tier 1) | **Finnomena public API** `GET https://www.finnomena.com/fn3/api/fund/v2/public/funds/{fund_code}/nav/q?range=1M` — **no API key**, keyed by plain fund code (e.g. `ES-FIXEDRMF`), returns `{ data: { fund_id, short_code, navs:[{date,value,amount}] } }` (`value`=NAV/unit, chronological). Freshest source, widest coverage (incl. funds **absent from SEC profiles** like ES-FIXEDRMF). Source is Morningstar (`fund_id` = Morningstar SecId). Confirmed reachable from GAS 2026-06-24. Tried first whenever a `fund_code` is set. **Code matching is case-insensitive and trims whitespace** (verified 2026-06-25 with `ES-GQGRMF`: lowercase + trailing-space both 200); an unknown code returns HTTP 404 with a `{status:false}` JSON body. `_fetchFinnomenaNav` never throws | `current_nav_thb` + `nav_date` + `nav_updated_at` on `mutual_fund_holdings` |
| Mutual fund NAV (Tier 2 fallback) | SEC Open Data v2 `GET /v2/fund/daily-info/nav?proj_id&start_nav_date&end_nav_date` (header `Ocp-Apim-Subscription-Key`); response wrapped in `{ items: [...], next_cursor, page_size }`; `last_val` = NAV/unit; matched on exact `fund_class_name`; **NAV lag is fund-specific** (not just weekends) — SEC publishes days after valuation date; `_secApiItems` follows `next_cursor` pagination (≤10 pages) so all rows are fetched. Official fallback, used only when Finnomena returns nothing | same columns on `mutual_fund_holdings` |
| Mutual fund search | SEC Open Data v2 `GET /v2/fund/general-info/profiles?fund_class_name=` — partial name matching works (e.g. "KKP CorePath" → 12 results); fields: `proj_id`, `fund_class_name`, `proj_name_en`, `comp_name_en` (AMC) | frontend display only |

> Thai Mutual Fund NAV fetching (SEC Open Data API + scrapers) was removed 2026-06-19. See **"Mutual Funds — rebuild plan"** at the bottom for prior findings and the fresh-start design.

**Gold price chain** (`_fetchGoldSpotPrice()` in DataAgent.gs): each source logs its HTTP code + raw body to the GAS execution log for diagnosis. Yahoo Finance forex symbols (`XAUUSD=X`) are unreliable from GAS server IPs — equity/ETF prices (GLD) are used instead as fallback.

**Standalone tests** — run from GAS IDE:
- `testGoldPrice()`, `testBondScrape()` — existing
- `testSingleFundNAV()` — confirmed SEC v2 `/fund/daily-info/nav` call for `M0209_2554`; logs all classes + `last_val` per class. Response is `{ items: [...] }`.
- `testSearchMFFunds()` — confirmed SEC v2 `/fund/general-info/profiles` by name; logs raw body + mapped `[{proj_id, fund_class_name, proj_name_en, amc_name}]`. Partial name matching works.
- `testFinnomenaNav()` — confirmed Finnomena public NAV API reachable from GAS (no key); tests `ES-GQGRMF`, `ES-FIXEDRMF` + 1 control, logs latest NAV per fund. PASS = every code shows a NAV; FAIL = HTTP 403 / HTML challenge (IP-blocked). Edit the `CODES` array to check a specific held fund's reachability from GAS.

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
_anDate             // Analysis page: selected news_date (YYYY-MM-DD)
_anRows             // Analysis page: daily_news rows for the selected date
_anTickerFilter     // Analysis page: active $TICKER filter (null = show all)
```

## Pages / navigation

6-tab bottom nav: **Home · US · Cash · Asset · Analysis · Settings**

`navigate(page)` → `loadPage(page)` dispatches to the loader function.

```
dashboard     Home — net worth, Me/Combined toggle, donut, asset cards
us            US Portfolio — combined metric cards, tab per portfolio, holdings table
gold          Gold — metric cards, S/R bar, holdings table, add/edit modal
mf            Mutual Funds — hero (total + P/L + "checked / NAV as of" dates), sort bar, expandable fund cards with NAV date badge, SEC name search, auto-refresh via SEC API
cash          Cash — total summary card, grouped by type (Savings/FD/FCD)
insurance     Insurance policies
private       Private Investment — summary (total principal, expected annual income, company/govbond split) + per-investment cards (company loans & govt bonds), add/edit/delete modal with type toggle
bonds         Thai Bonds — KPI cards, 2 donut charts, master-detail list
analysis      Analysis — daily Tech-News brief history (date selector + 🎯 holdings news + 📊 market news, sentiment-colored cards) on top, then a "Tools" hub (DCA/Monthly/Weekly/All Portfolio). Reads daily_news + daily_news_impact directly via Supabase.
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
- `loadDashboard()` — parallel fetch both users, renders hero + user cards + donut; asset summary is rendered by `_refreshDonut` (not by `loadDashboard` itself)
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], cashUSD, cashBreakdown, goldUSD, mfUSD, privateUSD, insuranceUSD, bondsUSD, cryptoUSD, otherUSD }`
- `switchDonutMode('me'|'combined')` — re-renders donut from `_dbCache` without re-fetching
- `_refreshDonut()` → `_renderAssetSummary(segments, totalUSD)` — 2-column card grid (`#db-port-summary`) below donut; one card per donut segment, percentages match exactly. **Note**: the old `#db-metrics` 2×2 grid (US Portfolio / Cash / Gold / Other) was removed 2026-06-20 — it was duplicate stale code.

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

### Mutual Funds
- `loadMutualFunds()` → `_loadMutualFundsInner(el)` — fetches `mutual_fund_holdings` (selects `nav_date` too), computes per-holding value/cost/PL, renders hero + sort bar + expandable fund cards. All THB. Wrapped in try/catch (errors only toast, never crash).
- Per holding: `costValue = units × avg_cost_thb`; value uses `current_nav_thb` when set, **else falls back to cost basis** (so a fund with no NAV still counts toward net worth but shows P/L `—`). `isAuto = !!sec_proj_id && nav_updated_at < 48h`.
- `_renderMFHero(latestTs)` — hero shows `"checked DD Mon · latest NAV DD Mon"` (newest `nav_date` across all linked funds via `.sort().pop()`; shows valuation lag clearly).
- `_renderMFList()` / `setMFSort(key)` / `toggleMFExpand(id)` / `_mfCatStyle(cat)`
- Expanded card detail shows: Cost value · Units · Cost/Unit · Current NAV · **NAV date (SEC)** · **Last checked** · Purchase date · Notes.
- Badge: 🟢 **Auto NAV · DD Mon** (SEC valuation date inline) when `isAuto`, else 🟡 **Manual NAV**.
- **Modal**: Buy/Sell type toggle, free-text fund name (`autocapitalize="words"`) + `<datalist>` local autocomplete + **🔍 Search SEC database** button, category pills (Onshore/Offshore/RMF/ESG/SSF/Other), 3 input methods (Total Baht / Total Units / Manual), Cost/Unit, Purchase date, optional Current NAV, optional `sec_proj_id` + **Find classes** button + class name field, collapsible notes. All money fields use `inputmode="decimal"` (shows decimal-point key on mobile). `saveMF()` is a pure DB insert/update; **never awaits a GAS/external call**. After the save commits, closes, and reloads the list, if the holding has a `fund_code` or `sec_proj_id` it kicks a **fire-and-forget** `callGAS('refreshMFNav')` (`.then`/`.catch`, never awaited) so a new auto-source fund flips 🟡 Manual → 🟢 Auto within a few seconds instead of waiting for the 8PM trigger or a manual ↻. All errors swallowed.
- **SEC fund search**: `searchMFFunds()` → GAS `mfSearchFunds?q=` → tappable results list → `_pickMFFund(i)` auto-fills `sec_proj_id` + `sec_fund_class_name`. Explicit button; never blocks save.
- **Find classes**: `lookupMFClasses()` → GAS `mfLookupClasses?projId=` → class dropdown (`_onMFClassSelect`). Use after pasting a proj_id manually.
- `openMFNavModal(id, name)` / `saveMFNav()` — "Update NAV" button stores `current_nav_thb` + `nav_updated_at` only (no `nav_date` — that's SEC-sourced).
- Top-bar ↻ → `refreshMFNav()` → GAS `refreshMFNav` → reloads page.
- Globals: `_mfListData`, `_mfEditId`, `_mfSortKey`, `_mfExpandedId`, `_mfCategory`, `_mfInputMethod`, `_mfType`, `_mfNavId`, `_mfSearchResults`.

### Cash
- `loadCash()` — shows total summary card (grouped by sub_type) above account sections
- `balance` column is always THB principal for all account types
- FCD: `balance = fcd_amount × fcd_purchase_rate`

### Private Investment
- `loadPrivate()` — fetches `private_holdings`, renders a summary card (Total Principal + position count, Expected Annual Income = Σ principal×rate for **active** only, **Next Payout** amount+date, Private Company vs Government Bond split) + one card per investment. All THB.
- Cards show: name, plan name, type chip, status pill (active=green / matured=gray / withdrawn=amber), principal, interest/coupon % + payout frequency, **next payout** (amount + date, active only), maturity date + countdown (`_privCountdown`, active only). Edit ✎ / delete 🗑 icons.
- `_privNextPayout(it)` → `{date, amt}` for the next periodic payout — **reuses the Thai-bond helpers** `_nextCouponDate` (start_date as anchor) + `_couponPerPayment` (principal_thb base). Null `payout_freq` = lump sum at maturity (no schedule).
- Modal: type toggle (**Private Company** / **Government Bond**) re-labels fields & hides term/withdrawn for govbond. `calcPrivMaturity()` auto-fills maturity = start + term (months/years), still editable. `savePriv()` is a pure DB insert/update (no external calls).
- Net-worth contribution = `principal_thb` (THB), wired into `calcUserData` + `loadMore` as `privateUSD`/`privTHB`.
- Globals: `_privEditId`, `_privType`, `_privStatus`. Reuses `_daysTo` / `_fmtShortDate` / `_numInputFmt` / `_parseNum` from the bonds section.

### Asset hub (More page)
- `loadMore()` — fetches live THB values for all 5 asset types in parallel (gold, insurance, private, **MF**, bonds), renders each row as: icon + name | ฿value + % of subtotal | ›
- % is share of the five-asset subtotal (gold + insurance + private + MF + bonds), not total portfolio
- MF value = `units × current_nav_thb` (falls back to cost basis when NAV not set)

### Analysis (News brief history)
- `loadAnalysis()` — entry for the Analysis tab. Queries distinct `news_date` for `state.userId`, populates the date dropdown, defaults `_anDate` to **the most recent day that has news** (today if present, else latest; today is always kept selectable so an empty day shows "No news yet"), then `_anRenderDate()`.
- `_anRenderDate()` — fetches `daily_news` for the user+date with embedded `daily_news_impact(impact)` (PostgREST FK embed), ordered by `sort_order`; sets the ‹ older / newer › button disabled states; calls `_anPaint()`.
- `_anPaint()` — splits rows into 🎯 holdings (`is_holding_related`) + 📊 market sections, renders `_anCard()` for each. Honours the active `_anTickerFilter`.
- `_anCard(r)` — sentiment-colored card (`_anSentClass`: positive=green / negative=red / neutral=blue left border): emoji + clickable `$ticker` badge + headline + impact box (holdings only) + `ที่มา:` sources.
- Date nav: `anSelectDate(d)` (dropdown), `anStepDate(±1)` (‹/›). Ticker filter (nice-to-have): `anFilterTicker(t)` / `anClearFilter()` filter the loaded date's rows to one ticker.
- Helpers: `_anEsc` (HTML escape), `_bkkToday`, `_anDateLabel` (Today / Yesterday / date). Reads Supabase directly (anon read); no GAS call. The page is data-only — all writes come from `sendDailyNewsBrief()`.

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
- `.mf-hero` / `.mf-hero-total` / `.mf-hero-pl` / `.mf-hero-ts` — MF page hero card
- `.mf-fund-card` / `.mf-card-head` / `.mf-card-left` / `.mf-card-right` / `.mf-card-chevron` — expandable fund cards
- `.mf-card-badges` / `.mf-cat-badge` / `.mf-nav-badge.set` / `.mf-nav-badge.unset` — category + NAV status badges
- `.mf-card-detail` / `.mf-detail-row` / `.mf-detail-lbl` / `.mf-detail-val` — expanded detail rows
- `.mf-nav-btn` — "Update NAV" button in card detail
- `.mf-cat-pill` / `.mf-cat-pill.active` — category selector pills in modal
- `.mf-sort-select` — sort dropdown
- `.mf-search-row` / `.mf-search-row-name` / `.mf-search-row-sub` / `.mf-search-row-pid` — SEC fund search result rows
- `.an-datebar` / `.an-date-select` / `.an-date-nav` — Analysis page date selector + ‹/› nav
- `.an-section-title` / `.an-tools-head` — Analysis section headers (🎯 / 📊) + "Tools" hub label
- `.an-card` (`.pos` / `.neg` / `.neu`) / `.an-card-head` / `.an-emoji` / `.an-ticker` / `.an-headline` / `.an-impact` / `.an-impact-lbl` / `.an-sources` — News brief cards (sentiment-colored left border)
- `.an-filter-pill` — active ticker-filter chip (tap to clear)

## Thai bank config

`THAI_BANKS` embedded inline in `index.html` (19 banks). Helper: `_bankLogoImg(code, size)` → `<img>` with circular crop + brand-color border. Logos in `assets/banks/{CODE}.png`.

## Service worker

Cache name: **`smart-me-v69`**. Bump on every `index.html` change.

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

**Phase 2 — optional automated NAV refresh (additive, never blocks saves) — ✅ DONE 2026-06-20**
> Built with the **SEC Open Data v2** endpoint (validated working): `GET /v2/fund/daily-info/nav?proj_id&start_nav_date&end_nav_date` with `Ocp-Apim-Subscription-Key`. Response is `{ items: [...], next_cursor, page_size }` (not a root array — `items` key fixed in production after confirming with live logs). `last_val` is the NAV/unit. **One proj_id returns several `fund_class_name` variants** (…-ES, …-SSF) with different NAVs, so the user stores both `sec_proj_id` and the exact `sec_fund_class_name`. `refreshMFNav` (daily 8PM trigger `onMFNavTrigger` + manual ↻ button) queries a **14-day window** (covers long SEC publishing lag + Thai holidays), follows `next_cursor` pagination to get all rows, matches the exact class, takes the most recent `nav_date`, and PATCHes `current_nav_thb` + `nav_date` + `nav_updated_at`. Per-holding failures log & skip — never throw, never touch a manual value. **NAV lag is fund-specific** (not just weekends): SEC publishes days after the valuation date; `nav_date` vs `nav_updated_at` makes this visible. Verified ~18.11 THB for KKP CorePath Balanced (`M0209_2554`).

**Phase 2 additions (same session) — ✅ DONE 2026-06-20**
> **SEC fund-name search**: `lookupMFFunds(q)` hits `/v2/fund/general-info/profiles?fund_class_name=` (partial matching confirmed, e.g. "KKP CorePath" → 12 results across 4 funds × 3 classes). Fields: `proj_id`, `fund_class_name`, `proj_name_en`, `comp_name_en` (AMC — note: response has no `amc_name` field; use `comp_name_en`). In the modal, **🔍 Search SEC database** button → tappable result list → tapping auto-fills `sec_proj_id` + `sec_fund_class_name`. GAS action: `mfSearchFunds?q=`.
> **`nav_date` column** (migration 016): stores the SEC valuation date separately from `nav_updated_at` (last-polled timestamp). Hero shows `"checked DD Mon · latest NAV DD Mon"` (newest across funds). Card badge: `🟢 Auto NAV · DD Mon`. Card detail: separate "NAV date (SEC)" + "Last checked" rows. This makes SEC publishing lag visible instead of mysterious.
> **`inputmode="decimal"` sweep**: all 26 money/rate/unit fields now show the numeric pad with a decimal-point key on iOS/Android. `type="text"` fields kept as-is (comma formatter `_numInputFmt` breaks with `type="number"`). Integer-only duration fields left alone.

**NAV staleness fixes — ✅ DONE 2026-06-20 (follow-up)**
> Three bugs caused stale/wrong NAV display:
> 1. **`_secApiItems` only fetched page 1** — SEC paginates with `next_cursor`; a fund with multiple classes over a 14-day window (e.g. 4 classes × 14 days = 56 rows) overflows one page and the newest rows were never seen. Fixed: `_secApiItems` now follows `next_cursor` in a loop (≤10 pages), collecting all rows before returning.
> 2. **7-day window too narrow** — funds where SEC publishing lag exceeds 7 days returned 0 rows and were silently skipped, leaving stale NAV in the DB. Fixed: `refreshMFNav` now uses a **14-day window** (`_bkkDate(14)` → `_bkkDate(0)`).
> 3. **`_fmtShortDate` broke on full ISO timestamps** — `nav_updated_at` is a timestamp (`"2026-06-20T08:15:00Z"`), but the helper appended `T00:00:00` unconditionally, producing an unparseable string → "Last checked" showed "Invalid Date" in the expanded card detail. Fixed: now checks `dateStr.includes('T')` before appending.

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
