# MyAsset+ — Asset Tracker

> **DCA Plan — per-portfolio export tabs, no auto-clear, separate Submit lock (2026-07-11)**: Three adjustments to the Export flow. **(1) Export no longer clears/rolls over** — `_dcaExportSheet(portfolioId)` now *only* exports (toast + `window.open` the sheet); it does **not** stamp `submitted`, seed next-month plans, or switch months. Plan data stays exactly as-is; a new month is started only via the ＋ button. **(2) Per-portfolio tabs** — `exportDCAToSheet(userId, monthYear, portfolioId)` writes each portfolio to **its own tab** (named after the portfolio) inside `MyAsset+ DCA History`, rows appended chronologically; new helpers `_exportPlanToTab` (per-portfolio rows + a `portName · TOTAL` summary row), `_getOrCreateDCATab` (sanitizes `[ ] * ? / \ :`), `_cleanupDefaultSheet` (drops the empty default `Sheet1`). `portfolioId` set → that one tab; omitted → every portfolio. `gas/Code.gs` action `dcaExportSheet` gained param `portfolioId` (blank ⇒ all); returns `result.export = {exported, month, sheetName, url, portfolios:[{portfolio,rows,done,total}], done, total}`. Frontend shows **Export ⟨PortName⟩ to Sheets** (active tab, `_dcaExportSheet('<id>')`) + **📊 Export All Portfolios** (`_dcaExportSheet()`). **(3) Submit ✓ + locked state** — new **Submit ✓** button (`.dca-complete-btn.mark`) above the export buttons flags every plan for the month `status:'submitted'` (`_dcaSubmitMonth`), then re-renders locked: `_dcaRenderActive` computes `locked = plan.status==='submitted'` → all Planned/Actual inputs + ✓ checkboxes `disabled` (grayed via `.dca-io:disabled`/`.dca-check:disabled`), status pill forced to **SUBMITTED**, and no derived-status writes. Submit and Export are independent; after Submit the export buttons stay and ＋ still works; `_dcaUpdateCompleteBtn` shows `✓ Submitted — locked` (disabled) once every plan for the month is submitted. No migration (028 already allows `submitted`). SW cache `myasset-v113`. **⚠️ Paste `gas/DCAAgent.gs` + `gas/Code.gs` and redeploy the Web App** (new `portfolioId` param).

> **DCA Plan — replaced "Submit & Email" with "Export to Google Sheets" (2026-07-11)**: The DCA month-close action no longer emails a summary — it **appends the month to a Google Sheet**. **GAS** (`gas/DCAAgent.gs`): `emailMonthSummary()` (+ `_usd`/`_monthLabel`/`_SUMMARY_EMAIL`, all GmailApp code) removed, replaced by **`exportDCAToSheet(userId, monthYear)`** → reads `dca_plans`+`dca_plan_items`, appends **one row per ticker per portfolio** (`Month | Portfolio | Ticker | Suggested | Planned | Actual | Done | Export Date`) plus a per-month **`ALL | TOTAL`** summary row (`$X planned` / `$Y actual` / `D/N done`) to a single spreadsheet **`MyAsset+ DCA History`** (batched `setValues`; header + frozen row written only when the sheet is empty). Helper **`_getOrCreateDCASheet()`** remembers the file via Script Property **`DCA_SHEET_ID`** (→ `openById`), falls back to a `DriveApp.getFilesByName` lookup, else `SpreadsheetApp.create`s it — so month 1 creates, later months append. `_monthShort()` = `2026-07`→`Jul 2026`; export date is `Asia/Bangkok` `yyyy-MM-dd`. Top-level **`testExportDCAToSheet()`** (Chelsea's id hard-coded) added for one-off IDE verification (the module is an IIFE, so it needs a top-level entry to appear in the Run dropdown). **`gas/appsscript.json`**: dropped the mail scopes (`script.send_mail`, `https://mail.google.com/`), added **`spreadsheets`** + **`drive.file`** (kept `external_request` + `scriptapp`) → **re-authorize once**. **`gas/Code.gs`**: web action `dcaEmailSummary` → **`dcaExportSheet`** (params `userId`, `month`; `mode` dropped; returns `result.export`). **Frontend** (`index.html`): `_dcaSubmitEmail()` → **`_dcaExportSheet()`** calls `dcaExportSheet`, on success toasts **`✅ Exported to Google Sheets — MyAsset+ DCA History`** and **`window.open`s the returned spreadsheet url**, then keeps the exact same archive+rollover (stamp month `submitted`, seed blank next-month plans, jump to next month); on failure toasts `❌ Export ไม่สำเร็จ — กรุณา re-authorize GAS ก่อน`. Button label `📧 Submit & Email Summary` → **`📊 Export to Google Sheets`** (in `_dcaUpdateCompleteBtn`; still hidden on already-submitted months). Verified `exportDCAToSheet` end-to-end from the GAS IDE before wiring. No migration. SW cache `myasset-v112`. **⚠️ Paste `gas/DCAAgent.gs` + `gas/appsscript.json` + `gas/Code.gs`, re-authorize (Sheets/Drive scopes), and redeploy the Web App.**

> **DCA Plan — Gmail send + Submit archives month & rolls over (2026-07-11)**: Two fixes to the DCA Plan "Submit & Email Summary" flow. **(1) Email send** — `MailApp.sendEmail()` failed with `คุณไม่ได้รับอนุญาต…` (not authorized). Switched `gas/DCAAgent.gs` `emailMonthSummary()` to **`GmailApp.sendEmail()`** and **created `gas/appsscript.json`** with the required OAuth scopes (`script.send_mail`, `script.external_request`, `script.scriptapp`, `https://mail.google.com/`) + preserved `Asia/Bangkok` TZ and the web-app config (`USER_DEPLOYING` / `ANYONE_ANONYMOUS`). Because DCAAgent's functions live inside an IIFE module (no top-level fns → nothing in the Run dropdown), re-auth is done by adding a throwaway top-level `function reauthMail(){ GmailApp.sendEmail('chanika.cptk@gmail.com','GAS re-auth','ok'); }`, running it once to grant the Gmail scope, then removing it. **(2) Submit now archives + rolls over** — on success `_dcaSubmitEmail()` shows `✅ Email sent to …`, stamps the current month's plans **`status:'submitted'`** in Supabase (kept as history, not deleted), auto-creates blank **next-month** plans for every portfolio (budget carried via `_dcaPriorBudget`), and switches `_dcaMonth` to next month + `loadDCA()`. On failure a clean toast `❌ ส่งอีเมลไม่สำเร็จ — กรุณา re-authorize GAS ก่อน` replaces the raw error text. `_DCA_STATUS` gained a `submitted` label; the old **"✅ Complete Month"** button + `_dcaCompleteMonth()` were removed (button block hides on already-submitted months). **Migration 028** widens `dca_plans_status_check` to allow `'submitted'`. GAS 'submit' path no longer touches status (frontend owns the archive). SW cache `myasset-v111`. **⚠️ Run migration 028 in Supabase; paste `gas/DCAAgent.gs` + `gas/appsscript.json`, re-authorize (Gmail scope), and redeploy the Web App.**

> **US Portfolio — mobile Dime redesign v2: All tab + inline-expand + swipe (2026-07-10)**: Extends the mobile-only (<768px) Dime layout; **desktop (≥768px) still untouched** (2-metric grid, wide `.pt-table`, stats bar). No migration/GAS. **(1) 'All' aggregate tab** — a new **first** tab (`#us-all-tab`, before Growth/…) via `loadAllPortfolioTab()`: pulls holdings from every portfolio and **merges duplicate tickers** (shares summed, avg cost re-derived as a share-weighted average so total cost/P-L stay right). Both real-tab and All-tab loaders now funnel through a shared **`_renderHoldingsView({holdings, portfolioName, portfolioId, isAll})`** (extracted from the old `loadPortfolioTab` body); All uses a stripped header (title + `+ Add`, no rename/Analyze) and `portfolioId:null`. `_usPortfolios` caches the portfolio list for aggregation. The live-price re-render branches on `isAll`. **⚠️ Default active tab stays Growth** — `loadUSPortfolio` now passes `tabsEl.querySelector('.tab-btn[data-portfolio-id]')` (not `.tab-btn`, which is now the All button). **(2) Summary card updates per tab** — split out **`_renderUSMobileSummary(metrics)`** (removed from `_renderUSMetricCards`, which now only fills the desktop grid); every tab load re-renders it with **that tab's own totals** (All = combined). Layout matches Dime: big `fmtVal` total, `Total Cost:`, **dashed** separator, then `1-Day Change` + `P/L` rows (amount-first: `↗ +$X (+Y%)`). **(3) Inline-expand holdings** — Dime cards restructured into `.ph-d-body` (swipe layer) → `.ph-d-main` + a collapsible `.ph-d-detail` (max-height/opacity transition, one open at a time via `_usExpandedTk`/`_usToggleExpand`); detail is a 2×2 grid Shares/Price · AVG Cost/Cost. **Split tap targets**: `.ph-d-left` (logo+ticker) → `openTickerDetail` modal; `.ph-d-right` (value + caret) → toggle expand. **(4) Swipe gestures** replace the edit/delete button row — inline `ontouch*` → `_swStart/_swMove/_swEnd` (`_sw` state, `touch-action:pan-y`, 70px threshold): **swipe-left = delete, swipe-right = edit**, revealing `.ph-swipe-bg` hints; a tap (<8px) falls through to the click handlers. Swipe is disabled on the All tab (merged rows have no single `portfolioId`). **CSS fix**: the mobile toggle rules (`.us-metrics-grid`/`.us-summary-card`/`.pt-stats`/`.pt-subtotal`/`.pt-mobilebar`/`.pt-assetcount`) sit in an `@media` block **earlier** in the sheet than their base defs, so at equal specificity the base won — re-scoped them under `#us-metrics-wrap`/`.pt-card` parents to win regardless of order. Verified locally in Chrome at 500px (summary/tabs/expand/modal/All/swipe) + desktop 1280px unchanged. SW cache `myasset-v109`. **Follow-up (v110)**: the mobile `.pt-subtotal` line was trimmed from "Value · Cost · P/L · N positions" down to just **"N positions"** (the value/cost/P-L are already in the summary card), and the now-duplicate `.pt-assetcount` "N assets" line under the sort bar was removed. Desktop `.pt-stats` unchanged.

> **Live price refresh now batched through GAS — fixes mobile (2026-07-10)**: Stock prices refreshed on desktop but silently failed on mobile. Root cause was **not** a CORS/proxy issue (no client-side proxy exists — the app already routes through GAS via `callGAS`); it was that `loadPortfolioTab`'s background refresh fired **~2×N GAS requests** (a `getPrice` + a `savePrice` per ticker), which mobile browsers/networks throttle → silent failures. Fix: consolidate into **one batched `getPrices` call**. New GAS action **`getPrices`** (in `gas/Code.gs` `doGet` router) takes `?tickers=NVDA,GOOGL,…`, fetches each server-side via `_yahooQuoteMeta`, persists to `market_data` via `DataAgent.savePrice` (so no separate `savePrice` round-trips), and returns `result.prices = {NVDA:202.78, GOOGL:358.89, …}` (one bad ticker is skipped, the rest still return). Frontend `loadPortfolioTab` background refresh now makes a single `callGAS('getPrices', {tickers: tickers.join(',')})`, writes results into `state.cache`, and re-renders the active tab. Verified live end-to-end. No migration. **⚠️ Paste `gas/Code.gs` into the Apps Script IDE and redeploy the Web App** (else `getPrices` returns "Unknown action"). SW cache `myasset-v108`. See the `getPrices` row in GAS actions.

> **US Portfolio — mobile-only Dime-style redesign (2026-07-09)**: Below **767px** the US Portfolio page is re-laid-out to match the Dime app; **desktop (≥768px) is untouched** (same 2-metric grid, `.pt-stats` bar, and wide `.pt-table`). Pure CSS-breakpoint swaps + extra render output — no JS view-switching, no migration, no GAS. **(1) Summary card** — a new `#us-summary-mobile` (`.us-summary-card`, inside `#us-metrics-wrap`) replaces the 2-card grid (`.us-metrics-grid` → `display:none` on mobile). Shows "Total Asset Value (date - time)" + big `_usPlainNum()` total with a small currency-unit suffix, "Total Cost: …", then two label-left/value-right rows (1-Day Change hidden when `!hasDayData`; Unrealized P/L with ↗/↘). `_computeUSCombinedMetrics` now also returns `totalCost`; `_renderUSMetricCards` fills both the desktop grid **and** the mobile card. `_usPlainNum(usdVal)` = grouped number without symbol, honours USD/THB toggle (THB 0-dp). **(2) Sub-total bar** — `.pt-subtotal` (compact single muted line "Value · Cost · P/L · N positions") replaces `.pt-stats` on mobile (both emitted in `statsBar`, CSS toggles). **(3) Dime holding cards** — `_renderPortTbody` now emits mobile cards **separately** from the desktop table (`.ph-card.ph-dime`): left = logo(30)+ticker+`⊕ weight%`, right = holding value (large, `fmtVal`) + a **toggled** secondary line; whole card taps → `openTickerDetail`; edit/delete kept as a subtle bottom actions row (with `event.stopPropagation()`). No per-holding THB line (toggle exists). **(4) Sort + toggle bar** (`.pt-mobilebar`, mobile-only) — a `.pt-sort-sel` `<select>` (`_usSetMobileSort`: az/za/value/plpct/day) + a `.pt-toggle-btn` that cycles the right column (`_usCycleRightCol`: Unrealized P/L | Current Price | 1D Change), plus a `.pt-assetcount` "N assets" line. New globals `_usMobileSort`/`_usMobileRightCol`/`_US_RIGHT_LABELS` (persist across tab switches & live-price re-renders); cards sorted independently of the desktop `_sortState` via `_sortMobileCards`; secondary line built by `_usCardSec`. Per-holding `dayPct`/`dayUSD` added to `_portTableData` (from `prevPrices`). SW cache `myasset-v107`.

> **GAS URL now persists in Supabase, not just localStorage (2026-07-08)**: Fixes "the app keeps asking for the GAS Web App URL on mobile" — localStorage gets wiped (cache clear, PWA eviction, device switch), so the URL vanished. The URL already lived in `app_config` (key **`gas_web_app_url`** — *not* `gas_url`; that's the real stored key, referenced by GAS `getConfig`/`saveConfig` + the migration-009 write policies), but `_loadGasUrl()` read **localStorage first** and only hit the DB as a last resort. Now **Supabase is the source of truth**: `_loadGasUrl()` does a direct anon `SELECT value FROM app_config WHERE key='gas_web_app_url'` first, caches the result to localStorage, and falls back to the cached copy only when offline / the read fails. Settings bootstrap (`loadSettings`) reads the same way (dropped its extra `callGAS('getConfig')` round-trip). `saveGasUrl()` unchanged — still writes via GAS `saveConfig` (service_role) **and** caches to localStorage. **Migration 027** narrows app_config's blanket `anon_read_all USING(true)` SELECT (migration 009) to a key-scoped, read-only `anon_read_gas_url USING (key='gas_web_app_url')` — only the non-sensitive GAS URL is anon-readable; writes still go through GAS. SW cache `myasset-v105`. **⚠️ Run migration 027 in Supabase.**

> **Full visual redesign — warm cream, light-theme-only (2026-07-08)**: Replaced the old blue/indigo + dark-mode system with a warm cream palette and a single bilingual font. **`DESIGN.md`** (repo root) is the design source of truth. New `:root` tokens: `--bg` #f6e9cf cream, `--primary` #558467 sage (buttons/active/CTA/positive P/L), `--accent` #b8684f terracotta (badges/alerts/negative P/L), `--s1` #eee0c5 cards, `--s2` #e5d4b0 inputs, `--muted` #7a6e5f, `--text` #1a1a1a, `--border` rgba(85,132,103,.2), + `--g`/`--r`/`--text-inv`; legacy tokens alias onto them (`--surface`→s1, `--surface2`→s2, `--success`→g, `--danger`→r, `--warning`→#c9922e gold). **Naming gotcha**: the old `--accent` (the *action* color) was globally renamed to `var(--primary)`; the new `--accent` is terracotta — so **buttons/active states use `--primary`, not `--accent`**. **Typography**: loads IBM Plex Sans Thai + Noto Sans Thai, applied everywhere via `--font`; Syne / Instrument Sans / JetBrains Mono removed (overrides the earlier "do not change fonts" note). **Charts** use a warm categorical palette (sage/terracotta/muted-gold/dusty-blue/warm-tan/olive). **Dark mode fully removed**: `html.dark` block, header 🌙 button, Settings→Appearance card gone; `toggleTheme`/`_syncThemeUI` are no-ops, `initTheme` just ensures light. Verified login + home live; SW cache `myasset-v101`.
> **US Portfolio — 1D change merged into Total Value card (2026-07-08)**: The US Portfolio metric cards went from **3 → 2** (`#us-metrics-wrap` grid `1fr 1fr 1fr`→`1fr 1fr`, each now 50% width). The standalone **1-Day Change** card (`#us-metric-day`) was removed; `_renderUSMetricCards` now appends a small **12px "1D $x (x%)"** line under the Total Value figure — `1D` label in `--text-muted`, value+% in `--success`/`--danger` per sign (same color logic) — and **hides the line entirely when `!hasDayData`** (previously showed a `—` card). The loading-skeleton loop dropped `us-metric-day` too. `_computeUSCombinedMetrics` / `dayChangeUSD` math untouched. CSS-only + one render function; no migration, no GAS. SW cache `myasset-v104`.
> **Mobile layout fixes (2026-07-08)**: (1) **US Portfolio holdings** — below 768px the wide table is swapped for a **card-per-holding** layout (`.ph-cards`/`.ph-card`: logo+ticker+price, shares, Avg Cost / Value / P/L, edit+delete); `_renderPortTbody` emits both the `<tbody>` and `#pt-cards`, CSS media query toggles them; desktop table unchanged. (2) **Home asset grid** — added `min-width:0` to the `1fr 1fr` cards so long values no longer overflow/clip on the right (grid item `min-width:auto` fix). (3) **Bottom nav** — `padding-bottom: max(12px, env(safe-area-inset-bottom))` for the iOS home-indicator safe area. SW cache `myasset-v102`.

> **Renamed "Smart Me" → "MyAsset+" (2026-06-27)**: app name updated everywhere — `<title>`, login header, `apple-mobile-web-app-title`, `manifest.json` `name`/`short_name`, and GAS ping + Telegram test-alert strings (`gas/Code.gs`). New wallet app icon from `assets/icons/M+ V7.svg` — exported PNGs (favicon 16/32, `apple-touch-icon` 180, PWA 192/512) live in `assets/icons/`, 1024 master at `assets/icon-source.png`. The SVG rasterizes onto an **opaque white** background, so the white was **flood-filled to `#f6e9cf`** from the corners (leaving the off-white "M+" lettering intact) rather than alpha-flattened. App `theme_color`/`background_color` (manifest) + `<meta name="theme-color">` are also `#f6e9cf`. SW cache `myasset-v77`. See **"App icon"** section.

## What this is

A personal finance PWA for 2 users (partners). Tracks US stocks/ETFs, gold, cash (savings/FD/FCD), insurance, private investments, Thai bonds, mutual funds, and loans/receivables (money lent out — tracked but excluded from net worth). AI-powered portfolio analysis, DCA planning, and Telegram notifications via Google Apps Script + Claude API.

> **Mutual Funds — fully rebuilt 2026-06-20** — Phase 1 (manual NAV, insert-only) + Phase 2 (daily auto-refresh) + fund-name search complete. See **"Mutual Funds — rebuild plan"** at the bottom.
> **NAV source order flipped 2026-06-25**: NAV refresh is now **Tier 1 Finnomena by `fund_code`** (freshest, no key, widest coverage) → **Tier 2 SEC by `sec_proj_id`** (official fallback) → Tier 3 manual. Also: adding a fund with an auto source now kicks a **fire-and-forget** NAV refresh so its card flips 🟡→🟢 within seconds instead of waiting for the 8PM trigger.
> **Daily Tech-News brief + Analysis page (2026-06-26)**: New holdings-aware morning brief — `NotificationAgent.sendDailyNewsBrief()` (7AM trigger `onNewsBriefTrigger`) uses Claude's **server-side `web_search` tool** to find today's tech/market news, flags stories about tickers the user holds with 🎯, sends via Telegram, and **persists** to `daily_news` + `daily_news_impact` (migration 021). The **Analysis tab** now reads those tables to show a browsable, sentiment-colored news history (date selector + 🎯 holdings / 📊 market sections), with the DCA/review hub kept below as "Tools". **Depth is decoupled**: Claude returns the full ~8-12 stories (all persisted to the page); Telegram is capped to a scannable top 6 with a "+N more" footer. See **"Daily Tech-News brief"** + **"Analysis"** sections.

> **Asset logos (2026-06-27)**: Brand logo icons next to every `$ticker` (holdings tables + Ticker Detail modal) and a generic fund icon on MF cards — same dual `src/config/*.js` + inline-`const` pattern as the bank logos. US-stock logos from `ticker-logos`, ETFs mapped by **fund issuer** (Vanguard/Schwab/JPMorgan/Invesco/BlackRock), crypto + gold from `nvstly/icons`. Each logo sits in a circular badge whose background is chosen per-logo (white / dark / fill) from measured brightness so contrast is right in **both** themes; unmapped tickers fall back to a colored initials badge. See **"Asset logos"** section.

> **Loan page — receivables (2026-06-27)**: New **Loan** page under the Asset hub for money the user lends OUT (migrations 022 + 023). `loans` + `loan_payments` (installment schedule, FK cascade). Per-loan cards (remaining, progress bar, next payment, status badge) → detail view with a payment-schedule checklist. **Partial payments**: `paid_amount` is a cumulative running tally; per-row status derived as paid / **partial (orange)** / overdue / pending; "Record Payment" adds to the tally (prefilled with the remaining due). **Per-row editable due dates** (inline date picker, independent — never shifts the rest). **DELIBERATELY excluded from net worth** — shown only on its own summary + an "outstanding · not in net worth" Asset-hub row; nothing wires into `calcUserData`/donut. SW cache `myasset-v79`. See the **Loans** rows in the DB tables, Pages, and Key functions sections. ⚠️ Run migrations 022 + 023 in Supabase.

> **DCA simulator in Ticker Detail modal (2026-06-29)**: New "จำลองซื้อเพิ่ม · DCA Simulator" card below Quick Stats in the Ticker Detail modal — simulate adding to a position before buying. Amount input + preset chips ($50/$100/$200/$500) recalc **live** (no submit) and show Current → After for Shares / Avg Cost / Value / P/L %, with an avg-cost delta badge (↓ green when DCA pulls the average down). **Only renders for tickers the user actually holds** (looked up in `_portTableData`). Pure client-side math, no DB/GAS calls. SW cache `myasset-v80`. See the **Ticker Detail modal** bullet in Key functions. No migration.

> **Insurance — detailed policy tracking (2026-06-29)**: Rebuilt the Insurance page into a full policy record (migration 024). `insurance_policies` extended with `policy_type` (Endowment/Unit Linked/Whole Life/Other), `policy_number`, `insured_name`, `status` (in_force/lapsed/matured), `policy_date`, `premium_mode` (annually/semi-annually/quarterly/monthly) + `premium_amount_thb` (per-payment), `payment_method`, `next_due_date`, `last_payment_date`/`_amount_thb`/`_method`, `notes`, `created_at` — **product name reuses the NOT-NULL `policy_name`**; legacy `annual_premium_thb` + `surrender_value_thb` stay but are no longer read. Page = summary (active count, annual premium commitment = Σ premium×freq for in-force, ⏰ due-within-30-days highlight) + per-policy cards (type badge, status dot, sum-assured/maturity/premium/next-due grid, "Last paid" line, edit/delete) + add/edit modal. Added anon insert/update/delete RLS. **⚠️ Insurance is now DELIBERATELY EXCLUDED from net worth** (informational only) — removed from `calcUserData` (no longer queried), the home donut segment, and `loadMore`'s subtotal; the Asset-hub row now shows total annual premium with an "Informational · not in net worth" sublabel (loans-style). SW cache `myasset-v83`. See the **Insurance** rows in DB tables, Pages, Key functions. ⚠️ Run migration 024 in Supabase.

> **MF "Guess code from fund name" helper (2026-06-30)**: New 🔍 button under the **Fund code** field in the MF add/edit modal — searches **Finnomena** by the typed fund name (falls back to a partial code in the field) and shows a tappable list of share classes; tapping fills `fund_code`, which the existing fire-and-forget refresh turns into a live NAV on save. Finnomena's search is strongest on **code fragments / short names** (full English names return fuzzy hits) — fine here since funds are often named by their code (e.g. holding `fund_name = "TGSMARTRMF-A"`). New GAS action `mfGuessCode` → `DataAgent.searchFinnomenaFunds(q)` (`…/funds/v2/public/funds/search?q=`, no key, never throws → `[{short_code, name_en, name_th, active}]`); frontend `guessFundCode()`/`_pickFundCode()` mirror the SEC-search pattern, reusing the `.mf-search-row*` styles. No migration. SW cache `myasset-v84`. ⚠️ Paste `gas/DataAgent.gs` + `gas/Code.gs` into the Apps Script IDE and redeploy the Web App, else the button returns "Search failed".

> **MF cards now show AMC logos (2026-06-30)**: Replaced the generic black fund glyph on Mutual Fund cards with the issuing **AMC** (asset-management company) logo, derived from the fund-code/name prefix by `_mfAmc(h)` (KKP→kkp, KT-→ktam, ES-→eastspring, 1AM-/ONE-→one, PRINCIPAL→principal, UOB→uob, TISCO/TG/TE→tisco, K-→kasikorn). `AMC_LOGOS` map (inline in `index.html` + mirrored in `src/config/assetLogos.js`) → `assets/logos/amc/*.png`. Five bank-affiliated AMCs **reuse the bank brand logos** (copied from `assets/banks/`: KKP, KBANK→kasikorn, TISCO, UOB, KTB→ktam); **Eastspring** = its double-chevron mark (cropped from Wikimedia Commons), **Principal** = the white-P gradient tile (principal.com apple-touch-icon, rendered `tk-fill`). Per-AMC badge style via `AMC_LOGO_DARK` (kkp = pale logo → dark badge) / `AMC_LOGO_FILL` (principal). **Fallback: an AMC with no sourced logo (ONE Asset Management — only a low-res wordmark exists) renders a colored initials badge** (`_tkBadge`, same as unmapped stock tickers) — text from `AMC_LABEL[amc]` so all of an AMC's funds share one badge (ONE → "ON"), never a broken/blank slot. `_fundLogoImg(h, size)` takes the holding; `_fundBadgeLabel(h, amc)` picks the badge text (AMC label → AMC key → fund code). `fund.svg` is no longer referenced. 21 of 23 holdings show a logo; the 2 ONE funds (1AM-DAILY-RA, ONE-DISC-ASSF) show the "ON" badge. No migration. SW cache `myasset-v86`. See **"Asset logos"** + **"Thai AMC logos"**.

> **Bigger bottom-nav touch targets (2026-06-30)**: Enlarged the 6-tab bottom nav for comfortable mobile tapping. `.nav-item` now `min-height:52px` + `justify-content:center` (whole icon+label block is a ≥44×44px touch target), padding `8px`→`12px`, icons `20px`→`25px`, label font `9px`→`10.5px`, gap `2px`→`4px`; `#bottom-nav` padding-bottom `var(--safe-bottom)`→`calc(var(--safe-bottom) + 6px)` (more clearance above the iOS home indicator). To keep the taller bar from overlapping content, the reserve was bumped `80px`→`96px` in both `.page` bottom padding and the `#toast` offset. CSS-only, no JS/markup change (single shared nav → applies to every page). No migration. SW cache `myasset-v87`.

> **Benchmark Comparison — last tab on the US Portfolio page (2026-07-02, moved from Analysis 2026-07-02)**: The **US Portfolio** page's tab strip now ends with a **📊 Benchmark** tab (after every portfolio tab). It plots your portfolio's growth against **NASDAQ (`^IXIC`)** and **S&P 500 (`^GSPC`)**, all **normalized to 100 at the first date** (index comparison, so % return is directly comparable regardless of scale). Controls: a **portfolio pill selector** (multi-select — `Total` + one pill per portfolio, auto-emoji via `_bmEmoji`: 🤖 AI / 🌍 ETF / 🚀 Growth / 💰 Dividend; selecting specifics combines their holdings into one cyan line), a **Timescale** segment (minute `1m` / hour `1h` / **day `1d` default**), and a **Timeframe** segment (1M/3M/**6M default**/1Y/YTD). Chart.js line chart, 3 dashed lines — NASDAQ yellow `#eab308`, S&P teal `#14b8a6`, portfolio cyan `#22d3ee` — index-mode tooltip showing `value (±%)` for all lines, custom bottom legend. **Portfolio line** = Σ(shares × historical close) per date across selected portfolios, from `holdings` × Yahoo daily closes. **New GAS action `benchmarkHistory`** (`_yahooChart(symbol, range, interval)`) returns `{ SYMBOL: {t:[unixSec],c:[close]} }` for a comma-sep symbol list — a thin, never-throwing Yahoo `/v8/chart` proxy. Frontend aligns series by UTC-date bucket (daily) / raw ts (intraday), forward/back-fills gaps, normalizes. `1m` interval is clamped to a `5d` range (Yahoo's minute-data limit). The tab is a `.tab-btn` in `#portfolio-tabs`; `showBenchmarkTab(btn)` sets it active and injects `_bmMarkup()` into `#portfolio-content`, then `initBenchmark()` (caches `_bmPorts`, keeps the pill selection across tab switches). No migration. SW cache `myasset-v92`. **⚠️ Paste `gas/Code.gs` into the Apps Script IDE and redeploy the Web App**, else the chart returns "โหลดข้อมูลไม่สำเร็จ". See the **Benchmark** rows in GAS actions + US Portfolio Key functions.

> **DCA Plan — multi-portfolio + manual execution tracking (2026-07-03)**: Rebuilt the DCA Plan page from a single Growth-only, GAS-generated approval list into a **per-portfolio planner the user drives by hand** (migration 025). **One plan per portfolio per month** (`dca_plans` gains `portfolio_id`; unique now `(user_id, portfolio_id, month_year)`; frontend now WRITES plans + items → anon insert/update RLS added). Page = a **month selector** dropdown (history, defaults to current month) + **portfolio tabs** (built from `portfolios`, auto-emoji via `_bmEmoji`), each tab independent. Per tab: header (month · **status pill** DRAFT→IN PROGRESS→COMPLETED · **DCA budget** input `$` comma-formatted · **🔄 Refresh**), a summary line (`N/M tickers completed · Planned $ · Actual $`), a table **TICKER · Reasoning · Suggested · Planned · Actual · ✓**, and a progress bar. **Refresh** runs the gap-from-target logic client-side (`_dcaGenerate`: lists **all holdings**, but only **underweight** tickers share the budget proportionally by gap — overweight ones show reasoning `At/above N% target (+x%)` and no-target ones `No target % set`, both with Suggested `—` yet still manually plannable; sorted so suggested rows lead; Suggested is non-editable, recalculates on Refresh) and **preserves** Planned/Actual/Done per ticker (`_dcaSyncItems`). **Planned/Actual** are editable inputs, **✓** a checkbox — all persist to `dca_plan_items` (new cols `planned_amount_usd`/`actual_amount_usd`/`is_done`; `suggested_amount_usd` relaxed to nullable/default 0). Status is **derived** from items (`_dcaDeriveStatus`) and mirrored to the DB. A **"+" button** next to the month selector (`_dcaAddNextMonth`) seeds a blank plan for the month after the newest (budget carried from prior month, no tickers) and jumps to it. **Two email buttons** (`#dca-complete-wrap`) → **GAS action `dcaEmailSummary`** → `DCAAgent.emailMonthSummary(userId, month, mode)` builds a per-portfolio plain-text summary (per-ticker **✅ done / 🔄 in progress / ⬜ not started**; subject `… (X/Total completed)`) and `MailApp.sendEmail`s it to **chanika.cptk@gmail.com** (no OAuth — GAS runs as owner): **📧 Submit & Email Summary** (`_dcaSubmitEmail`, `mode='submit'`) is **always shown** (any month with items) and does NOT change status; **✅ Complete Month** (`_dcaCompleteMonth`, `mode='complete'`) appears only when every ticker across ALL portfolios is ticked and additionally flags every plan `completed`. Globals `_dcaMonth`/`_dcaPortId`/`_dcaPorts`/`_dcaMonths`; helpers/CSS prefixed `_dca*`/`.dca-*`. SW cache `myasset-v96`. **⚠️ Run migration 025 in Supabase** + **paste `gas/DCAAgent.gs` + `gas/Code.gs` into the Apps Script IDE and redeploy the Web App** (else the email button returns "Unknown action"). `MailApp.sendEmail` adds a **new Gmail send OAuth scope** — the first save/deploy after pasting prompts the owner to **re-authorize**; run `emailMonthSummary(<userId>,'YYYY-MM')` once from the IDE to trigger the consent screen before relying on the button. See the **DCA Plan** rows in DB tables, Pages, Key functions, GAS actions, and migrations.

> **DCA Plan — mobile card layout (2026-07-07)**: Below **767px** the wide `.dca-table` is `display:none` and a **one-card-per-ticker** layout (`.dca-cards`/`.dca-card`) is shown instead (desktop table unchanged above 768px — no markup swap by JS, pure CSS breakpoint). Each card: **bold 17px ticker** top-left with the **muted 12px reasoning** beside it, a divider, then `Suggested` as **plain non-editable text**, full-width **labeled Planned + Actual** inputs, and a right-aligned **✓ Done** checkbox with a **≥44×44px tap target** (`.dca-card-done` label wrapping a 24px box). `_dcaRenderActive` now emits **both** renderings (`rowsHtml` + `cardsHtml`) into one `#dca-tab-content`; every editable control carries `data-item`/`data-field` so `_dcaSyncPair(itemId, field, el)` **mirrors an edit onto the ticker's other copy** (table row ↔ card) — this keeps `_dcaRecalcSummary` correct (it still reads the always-present table `<tbody>`) and syncs the `.done` dimming on both. `_dcaEditItem`/`_dcaToggleDone` call `_dcaSyncPair` before the DB write. CSS-only breakpoint, no JS-driven view switch, no migration, no GAS change. SW cache `myasset-v98`.

> **Google Sign-In alongside name-tap login (2026-07-08)**: Added "เข้าสู่ระบบด้วย Google" to the login screen next to the existing name-tap selector (migration 026). Design decision — **AUTO-LINK BY EMAIL, keep each user's existing `users.id` as the canonical `user_id` everywhere**, so the Google identity is just *attached* to the existing profile: **no migration of `user_id` across the ~12 asset tables** (the risky part of the original plan is avoided). Migration `026_users_google_auth.sql` adds `users.email` (unique, case-insensitive) + `users.auth_uid` (FK→`auth.users`, unique), seeds Chelsea (`…-0001`) = `chanika.cptk@gmail.com`, and adds an `auth_link_users` UPDATE RLS policy `TO authenticated` (a row is claimable when unlinked *or* already this caller's; `WITH CHECK (auth_uid = auth.uid())` so no one can point a profile at another identity). Partner's email intentionally **not** seeded — she hits the name-picker fallback on first login, which stamps her email. Frontend (`index.html`): `signInWithGoogle()` (`sb.auth.signInWithOAuth({provider:'google', options:{redirectTo}})`); `init()` is now async — `sb.auth.getSession()` → `handleGoogleSession(gUser)` (match by `auth_uid` then `email` → stamp link via `users` UPDATE → `_finishGoogleLogin` → `enterApp`; no match → `showGoogleLinkPicker`/`_renderLinkPicker`/`linkGoogleTo` name-picker fallback), falling back to the `localStorage` session when there's no Google session. `logout()` is now async + `await sb.auth.signOut()` (also removed a pre-existing dead `updatePinDots()` call → `initLoginScreen()`). Existing name-tap login untouched. **Auth infra**: Google OAuth is configured in Google Cloud (**Authorized redirect URIs = only the Supabase callback** `https://zchwqmykjjjtoaymuvwx.supabase.co/auth/v1/callback`; Google rejects wildcards) + Supabase **Auth → URL Configuration** (Site URL `https://chanikacptk.github.io/asset-tracker/` + Redirect URL `https://chanikacptk.github.io/asset-tracker/**` — Supabase *does* accept the `**` wildcard; this is where the post-callback app redirect lives). RLS note: all existing table policies are `USING(true)` with no `TO` clause → apply to `public` incl. `authenticated`, so the Google session keeps full read/write. Verified live 2026-07-08 (migration run): OAuth authenticates + app-side auto-link matched Chelsea by email and stamped `auth_uid`. SW cache `myasset-v100`. **⚠️ Run migration 026 in Supabase** + set the Supabase URL Configuration above (else the real button flow redirects to the default Site URL / a dead page). See the **Authentication** section + the `users` row in DB tables + migration 026.

> **Ticker Detail modal → tabbed layout (2026-07-02)**: Rebuilt the Ticker Detail bottom-sheet from one long scroll into a **TradingView-style tab bar** below the price header — **Overview · Technicals · News · Earnings · Simulator** (horizontal scrollable pills, `.td-tabbar`/`.td-tab`, active = `--accent`). Only the active tab renders into `#td-tab-content` (`_tdShowTab`); shared state in `_tdCtx`, per-tab data **lazy-loaded**. **Overview (NEW)** — key-stats list (volume, avg volume 30D, market cap, dividend yield, P/E TTM, EPS TTM, net income FY, revenue FY, float, beta 1Y, 52wk H/L) from a **new GAS action `getOverview`** → `_yahooOverview` → Yahoo **v10 `quoteSummary`** (`_yahooQuoteSummary` + cookie/crumb via `_yahooCrumb`, cached in ScriptCache; every field null-safe). **Technicals / News / Simulator** are the existing widgets, unchanged, just relocated under their tabs. **Earnings (NEW, added 2026-07-03)** — next earnings date + last-4-quarters EPS actual/estimate + revenue with a Beat/Miss badge, from a **new GAS action `getEarnings`** → `_yahooEarnings` (Yahoo `quoteSummary`) with a **Claude web-search fallback** (`_claudeEarnings`) when Yahoo is empty. No migration. SW cache `myasset-v92`. **⚠️ Paste `gas/Code.gs` into the Apps Script IDE and redeploy the Web App** (run `testOverview()` / `testEarnings()` there to confirm Yahoo reachability), else the Overview/Earnings tabs show "ไม่สามารถโหลดข้อมูล…". See the **Ticker Detail modal** bullet in Key functions + the `getOverview` / `getEarnings` GAS actions.

## Live URL

**https://chanikacptk.github.io/asset-tracker/** (GitHub Pages, auto-deploys from `main`)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file (`index.html`, ~9 680 lines) — vanilla JS, no build step |
| Fonts | **IBM Plex Sans Thai + Noto Sans Thai** (bilingual Thai/Latin) via one global `--font` stack (set 2026-07-08 redesign). Instrument Sans / Syne / JetBrains Mono all removed; `.mono`/`.pt-mono` map to `var(--font)`. See **DESIGN.md** |
| Styling | CSS variables (warm cream palette in `:root`). **Light theme only** — dark mode + `html.dark` removed 2026-07-08. See **DESIGN.md** |
| Charts | Chart.js 4.4.0 (CDN) |
| Database | Supabase (PostgreSQL + REST API) |
| Backend | Google Apps Script (GAS) — `.gs` files in `gas/` |
| AI | Claude API (`claude-sonnet-4-6`) called from GAS |
| Notifications | Telegram bot (per-user chat IDs) |
| PWA | `manifest.json` + `sw.js` (cache `myasset-v113`) |

CDN deps in `index.html`: `@supabase/supabase-js@2`, `chart.js@4.4.0`, Google Fonts.

## Deployment

```bash
git add <files>
git commit -m "..."
git push origin main   # GitHub Pages auto-deploys in ~60s
```

**Always bump `sw.js` cache version** (`myasset-vN`) when `index.html` changes.  
`index.html` is served **network-first** by the SW — a normal refresh picks up changes after deploy.

**If a deploy doesn't appear** (seen 2026-07-02/03): the `pages build and deployment` Action can build the artifact fine but then **hang in the deploy step** (`Current status: deployment_queued` → `Timeout reached, aborting!`), leaving the live site on the previous version — even while [githubstatus.com](https://www.githubstatus.com/) shows Pages "operational" (it lags real incidents). **The nasty part: a hung deploy stays "in progress" server-side and holds the Pages lock**, so the *next* deploy fails instantly with `400 — Deployment request failed … due to in progress deployment. Please cancel <sha> first`. Recovery that actually worked (2026-07-03):
> 1. **Stop all concurrent triggers** — kill any background poll/retry loops; concurrent Pages builds cancel each other (`##[error]Deployment cancelled`), making it look broken when it isn't.
> 2. **Cancel the stuck lock** the error names: `gh api -X POST repos/<owner>/<repo>/pages/deployments/<STUCK_SHA>/cancel` (returns empty/204). Find the culprit sha in the failed run log (`gh run view <id> --log-failed | grep "in progress deployment"`).
> 3. **Trigger exactly one build** (`gh api -X POST repos/<owner>/<repo>/pages/builds`, or a single empty commit) and **watch only** — don't re-trigger while it runs.
>
> Verify with `curl -s <live>/sw.js | head -1` (expect the new `myasset-vN`) and `gh run list`. Only one Pages deployment runs at a time, so a stuck run blocks all new ones. Remember the app is a PWA: after the deploy lands, a home-screen icon still needs the app **fully closed & reopened twice** (1st launch installs the new SW, 2nd serves it) to drop the old cached shell.

## Project structure

```
index.html              Main app — all HTML/CSS/JS (~9 680 lines)
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
  migrations/           026 migrations — 001–026 (018–026 must be run in Supabase; see list)

skills/
  add-asset-page.md     Pattern for adding new asset pages
  debug-price-fetch.md  Checklist for debugging wrong/zero price issues
  deploy-gas.md         Steps for updating and redeploying GAS
  supabase-migration.md Template for adding new tables with RLS
```

## Authentication

**Two ways in, one profile.**

1. **Name-tap selector (original, default)** — despite the "PIN" naming, the live flow is a **tap-your-name selector** (`loginAs(userId,…)`, no PIN keypad is shown). `users.pin_hash` + `salt` exist but are unused; leftover `.pin-keypad` CSS remains. Session in `localStorage` as `{ userId, userName, partnerId }`, auto-restored on load. This is **not** Supabase Auth.
2. **Google Sign-In (added 2026-07-08, migration 026)** — real Supabase Auth (`signInWithOAuth`). Design: **auto-link by email onto the existing profile** — `users.id` stays the canonical `user_id` everywhere; the Google identity is attached via `users.email` + `users.auth_uid` (no `user_id` migration across asset tables). `init()` is async: `sb.auth.getSession()` → `handleGoogleSession()` matches by `auth_uid` then `email`, stamps the link, `enterApp()`; unmatched → name-picker fallback (`showGoogleLinkPicker`) that stamps email on link. Falls back to the `localStorage` session when there's no Google session. `logout()` awaits `sb.auth.signOut()`. See the **Google Sign-In** changelog block up top for the full flow, RLS, and the Google Cloud / Supabase URL-config split.

`SUPABASE_ANON_KEY` is intentionally hardcoded in `index.html` — it is the publishable key only. **Never put `SUPABASE_SERVICE_KEY` in index.html.**

---

## Database tables

### Auth
| Table | Key columns |
|---|---|
| `users` | id, name, pin_hash, salt, avatar, telegram_chat_id, **email** *(unique, case-insensitive — Google auto-link key; Chelsea seeded, partner not)*, **auth_uid** *(FK→`auth.users`, unique — stamped on first Google login)* |
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
| `insurance_policies` | id, user_id, policy_name *(= product name, NOT NULL)*, policy_type (`Endowment`/`Unit Linked`/`Whole Life`/`Other`), insurer, policy_number, insured_name, status (`in_force`/`lapsed`/`matured`), policy_date, maturity_date, sum_assured_thb, premium_mode (`annually`/`semi-annually`/`quarterly`/`monthly`), premium_amount_thb *(per payment)*, payment_method, next_due_date, last_payment_date, last_payment_amount_thb, last_payment_method, notes, created_at, ~~annual_premium_thb~~ + ~~surrender_value_thb~~ *(legacy, no longer read)* — **INFORMATIONAL ONLY, excluded from net worth** |
| `private_investments` | id, user_id, name, current_valuation, currency *(legacy — superseded by `private_holdings`, no longer read by the app)* |
| `private_holdings` | id, user_id, inv_type (`company`/`govbond`), name NOT NULL, plan_name *(company only — plan within the company, e.g. "GET 1")*, principal_thb (always THB), rate_pct *(annual interest / coupon %)*, start_date *(investment/purchase date)*, term_value + term_unit (`months`/`years`, company only), maturity_date *(auto from start+term, editable)*, payout_freq *(`monthly`/`quarterly`/`semi-annually`/`annually`; null = lump sum at maturity)*, status (`active`/`matured`/`withdrawn`; govbond only uses active/matured), notes, created_at — backs the Private Investment page |
| `crypto_holdings` | id, user_id, coin_id, symbol, quantity, avg_cost_usd *(schema only, no UI)* |
| `mutual_fund_holdings` | id, user_id, fund_name NOT NULL, category (`Onshore`/`Offshore`/`RMF`/`ESG`/`SSF`/`Other`), units, avg_cost_thb (cost/unit), current_nav_thb *(nullable)*, nav_date *(nullable — source valuation date)*, nav_updated_at *(nullable — when we last polled)*, sec_proj_id *(nullable)*, sec_fund_class_name *(nullable — exact SEC class; one proj_id has many classes)*, fund_code *(nullable — plain code, e.g. ES-FIXEDRMF; primary Finnomena NAV key, tried before SEC)*, buy_date, notes, created_at |
| `thai_bonds` | id, user_id, bond_name NOT NULL, bond_code, credit_rating, face_value_thb, units, coupon_rate, coupon_type, issued_date, maturity_date, purchase_date, purchase_price_thb, price_per_unit_thb, notes |
| `bond_master` | bond_code PK, bond_name, issuer, credit_rating, coupon_rate, coupon_type, issued_date, maturity_date, scraped_at — ThaiBMA scrape cache |

### Loans (receivables — money lent OUT)
| Table | Key columns |
|---|---|
| `loans` | id, user_id, borrower_name NOT NULL, principal_thb (always THB), interest_rate *(nullable annual % — some loans interest-free)*, loan_date, frequency (`monthly`/`quarterly`/`custom`), custom_interval_months *(months between installments when `custom`)*, installment_amount, num_installments, status (`active`/`completed`/`overdue` — stored baseline `active`; **live status derived in UI** from payments + today), notes, created_at — backs the Loan page |
| `loan_payments` | id, loan_id (FK→loans, **ON DELETE CASCADE**), installment_number, due_date *(editable per-row in the UI — does not shift the others)*, expected_amount, paid_amount *(**cumulative amount paid on this installment** — running tally; supports partial payments)*, paid_date *(date borrower paid)*, paid_at *(timestamp the payment was recorded)*, status (`pending`/`paid`; **`partial` + `overdue` are derived in UI, never stored**), created_at — installment schedule |

> **Loans are DELIBERATELY EXCLUDED from net worth / Total Asset.** Never add them into `calcUserData`, the home donut, or `loadMore`'s asset subtotal. They show only on the Loan page's own summary, plus an outstanding-balance row in the Asset hub flagged "not in net worth".

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
| `dca_plans` | id, user_id, **portfolio_id** (FK→portfolios; one plan per portfolio per month), month_year, status (`draft`/`in_progress`/`completed`/`submitted`; legacy `approved`/`executed` kept — see migration 028), total_budget_usd *(user-set DCA budget, nullable/default 0)*, created_at — **unique (user_id, portfolio_id, month_year)**; anon read + insert/update |
| `dca_plan_items` | id, plan_id (FK→dca_plans, cascade), ticker, suggested_amount_usd *(gap-based, recalced on Refresh; nullable/default 0)*, **planned_amount_usd** *(user override)*, **actual_amount_usd** *(what was bought)*, **is_done** *(✓ checkbox)*, reasoning, adjusted_amount_usd + is_approved *(legacy)* — anon read + insert/update/delete |

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
- Frontend (anon key) can write: `holdings`, `portfolios`, `watchlist`, `cash_accounts`, `gold_holdings`, `dca_plan_items`, `private_investments`, `private_holdings`, `thai_bonds`, `mutual_fund_holdings`, `insurance_policies`, `loans`, `loan_payments` (the latter scoped by parent `loan_id`, not `user_id`)
- `bond_master`, `daily_news`, `daily_news_impact` are read-only for anon; GAS writes them via service_role
- GAS uses `service_role` key (bypasses RLS entirely)

### Migrations applied (001–017 ✓; 018–026 marked ⚠️ = run in Supabase)
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
022  loans + loan_payments: receivables tracker (money lent out) + installment schedule; anon RW RLS. Loans EXCLUDED from net worth  ⚠️ RUN IN SUPABASE
023  loan_payments.paid_at: timestamp a payment was recorded (partial-payment support reuses existing paid_amount as the cumulative tally)  ⚠️ RUN IN SUPABASE
024  insurance_policies: detailed policy columns (policy_type/number, insured_name, status, dates, premium_mode + amount, payment_method, next/last payment, notes, created_at) + anon write RLS. Insurance EXCLUDED from net worth  ⚠️ RUN IN SUPABASE
025  dca_plans + dca_plan_items: multi-portfolio DCA. Add dca_plans.portfolio_id (unique → user+portfolio+month; total_budget_usd relaxed; status widened to draft/in_progress/completed) + anon insert/update RLS. Add dca_plan_items.planned_amount_usd/actual_amount_usd/is_done (suggested relaxed) + anon insert/delete RLS  ⚠️ RUN IN SUPABASE
026  users: Google OAuth link. Add users.email (unique lower()) + users.auth_uid (FK→auth.users, unique); seed Chelsea's email; add auth_link_users UPDATE RLS TO authenticated (claim unlinked/own row, WITH CHECK auth_uid=auth.uid()). Google identity attached to existing users.id — NO user_id migration  ⚠️ RUN IN SUPABASE  ✓ (run 2026-07-08)
027  app_config: narrow the blanket anon_read_all USING(true) SELECT (from 009) to a key-scoped read-only anon_read_gas_url USING (key='gas_web_app_url') — only the non-sensitive GAS URL is anon-readable; writes still go through GAS (service_role). Makes the GAS URL DB the reliable source of truth so it persists across localStorage clears  ⚠️ RUN IN SUPABASE
028  dca_plans: widen dca_plans_status_check to allow 'submitted' (Submit & Email now archives the month with status='submitted'). CHECK IN (draft, in_progress, completed, submitted, approved, executed)  ⚠️ RUN IN SUPABASE
```

---

## GAS setup

Files are copy-pasted into Apps Script IDE — not auto-deployed from this repo.

> **⚠️ Publishing a new GAS action requires redeploying the Web App — and the clicks matter** (bit us 2026-07-03 with `getOverview`/`getEarnings`): pasting/saving code in the IDE, or running a `testX()` function from the editor, does **NOT** update the live Web App. The frontend calls the *deployed* URL, which keeps serving the old version until you publish — so a new action returns `{ok:false, error:"Unknown action: …"}` and the feature silently shows its "unavailable" state. To publish: **Deploy ▸ Manage deployments ▸ ✏️ Edit the existing deployment ▸ Version: New version ▸ Deploy** (Edit, *not* "New deployment" — a new deployment mints a new URL the app doesn't know). URL is unchanged. Confirm with `‹exec-url›?action=getOverview&symbol=O` in a browser (expect JSON with `overview`, not "Unknown action").

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
| `getPrices` | **Batched** quote — params `tickers` (comma-sep, e.g. `NVDA,GOOGL`). Fetches each server-side via `_yahooQuoteMeta`, persists to `market_data` via `DataAgent.savePrice`, returns `result.prices = {SYM: price, …}` (bad tickers skipped). Backs `loadPortfolioTab`'s background live-price refresh — one call replaces the old ~2×N `getPrice`+`savePrice` fan-out that throttled on mobile |
| `getHistory` | `_yahooHistory(symbol)` — 6-month daily **closes** + `price`, `prevClose`, `week52High/Low`, best-effort `marketCap`/`peRatio` (v7 quote, degrades to null). Backs the **Ticker Detail modal** technicals gauge (RSI/SMA/MACD computed client-side). Never throws |
| `getOverview` | `_yahooOverview(symbol)` — key stats for the Ticker Detail **Overview** tab (volume, avg volume, market cap, dividend yield, P/E TTM, EPS TTM, net income, revenue, float, beta). Uses `_yahooQuoteSummary` (Yahoo v10 `quoteSummary`, modules `summaryDetail,defaultKeyStatistics,financialData,price`) which needs a cookie+crumb pair from `_yahooCrumb` (fc.yahoo.com → `/v1/test/getcrumb`, cached ~30 min in ScriptCache). Returns raw numbers; every field degrades to null and never throws. `testOverview()` in the GAS IDE verifies reachability (O, AAPL) |
| `getEarnings` | `_yahooEarnings(symbol)` — next earnings date + last-4-quarters EPS actual/estimate + revenue for the Ticker Detail **Earnings** tab. Yahoo `quoteSummary` (`earnings,earningsHistory,calendarEvents`) via `_yahooQuoteSummary`; **falls back to `_claudeEarnings`** (Claude `web_search`) only when Yahoo returns nothing. `{ nextDate, nextDateIsRange, currency, quarters:[{label,epsActual,epsEstimate,revenue,revenueEstimate}], source }`; never throws. `testEarnings()` verifies (O, AAPL) |
| `getGoldPrice` | DataAgent.fetchGoldPrice() — live spot, saves to DB, returns `{price, source}` |
| `savePrice` | DataAgent.savePrice() |
| `searchTicker` | Yahoo Finance search |
| `testTelegram` | send test message |
| `sendNewsBrief` | NotificationAgent.sendDailyNewsBrief() — generates + sends the daily holdings-aware Tech-News brief now (manual trigger for testing) |
| `dcaExportSheet` | `DCAAgent.exportDCAToSheet(userId, month, portfolioId)` — reads `dca_plans`+`dca_plan_items` for the month and appends **one row per ticker** plus a `portName·TOTAL` summary row to **that portfolio's own tab** (named after the portfolio) inside the spreadsheet **`MyAsset+ DCA History`** (id remembered in Script Property `DCA_SHEET_ID`; created on first export via `_getOrCreateDCASheet`; tabs via `_getOrCreateDCATab`). `portfolioId` set ⇒ that one tab; **blank ⇒ every portfolio**. Returns `result.export = {exported, month, sheetName, url, portfolios:[{portfolio,rows,done,total}], done, total}`. Needs the `spreadsheets` + `drive.file` scopes in `gas/appsscript.json`. Backs the DCA page's **Export ⟨PortName⟩ / 📊 Export All Portfolios** buttons (export only — no clear/archive/rollover). Params `userId`, `month` (`YYYY-MM`), `portfolioId` (optional). Replaced the old `dcaEmailSummary`/`emailMonthSummary` (GmailApp) action |
| `benchmarkHistory` | `_yahooChart` per symbol — params `symbols` (comma-sep, e.g. `^GSPC,^IXIC,NVDA`), `range` (6mo/1y/ytd/5d…), `interval` (1d/1h/1m). Returns `result.series = { SYMBOL: {t:[unixSec],c:[close]} }`; thin never-throwing Yahoo `/v8/chart` proxy. Backs the US Portfolio **Benchmark** tab |
| `scrapeBondInfo` | DataAgent.scrapeBondInfo(bondCode) — scrapes ThaiBMA, caches in bond_master |
| `refreshMFNav` | DataAgent.refreshMFNav() — daily NAV refresh for MF holdings with an auto source. **Tiered**: Tier 1 Finnomena by `fund_code` (`_fetchFinnomenaNav`) → Tier 2 SEC by `sec_proj_id` (`_secNavForHolding`) → Tier 3 manual (untouched). Stores `current_nav_thb`, `nav_date` (source valuation date), `nav_updated_at`; returns `{checked, updated, skipped}`; never throws/overwrites manual NAV. Holdings query: `or=(sec_proj_id.not.is.null,fund_code.not.is.null)` |
| `mfLookupClasses` | DataAgent.lookupMFClasses(projId) — returns `[{fund_class_name, last_val, nav_date}]` for the "Find classes" picker |
| `mfSearchFunds` | DataAgent.lookupMFFunds(q) — searches SEC `/v2/fund/general-info/profiles?fund_class_name=` by (partial) name; returns `[{proj_id, fund_class_name, proj_name_en, amc_name}]`; partial matching works; user taps result to auto-fill `sec_proj_id` + class |
| `mfGuessCode` | DataAgent.searchFinnomenaFunds(q) — Finnomena `GET …/funds/v2/public/funds/search?q=` by fund name or code fragment; no key; returns `[{short_code, name_en, name_th, active}]` (≤25); backs the MF modal's "Guess code from fund name" button → user taps to fill `fund_code`. Never throws |

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
| Mutual fund code search | **Finnomena public** `GET https://www.finnomena.com/fn3/api/fund/v2/public/funds/search?q=` — no key; returns `{ data: [{ short_code, name_th, name_en, sec_is_active, … }] }`; matches **code fragments / short names** well (full English names give fuzzy hits). Backs the modal's "Guess code from fund name" helper to fill `fund_code` | frontend display only |

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
us            US Portfolio — combined metric cards, tab per portfolio, holdings table, + a trailing 📊 Benchmark tab (portfolio vs NASDAQ/S&P 500, normalized-to-100 line chart)
gold          Gold — metric cards, S/R bar, holdings table, add/edit modal
mf            Mutual Funds — hero (total + P/L + "checked / NAV as of" dates), sort bar, expandable fund cards with NAV date badge, SEC name search, auto-refresh via SEC API
cash          Cash — total summary card, grouped by type (Savings/FD/FCD)
insurance     Insurance — INFORMATIONAL ONLY (excluded from net worth). Summary (active count + annual premium commitment + ⏰ due-within-30-days) + per-policy cards (type badge, status dot, sum-assured/maturity/premium/next-due grid, last-paid line, edit/delete) + add/edit modal. All THB.
private       Private Investment — summary (total principal, expected annual income, company/govbond split) + per-investment cards (company loans & govt bonds), add/edit/delete modal with type toggle
bonds         Thai Bonds — KPI cards, 2 donut charts, master-detail list
loans         Loan — receivables (money lent out). Summary (total remaining / principal lent / expected interest, active loans only) + per-loan cards (remaining, progress bar, next payment, status badge). Tap a card → detail view with the installment schedule checklist: per-row **Record Payment** (partial or full — amount added to a running tally), inline **editable due date**, and reset (↺). EXCLUDED from net worth. add/edit modal generates the schedule from frequency × count.
analysis      Analysis — **two tabs `[📰 News] [🛠️ Tools]`** (`anShowTab`, News default). News tab = daily Tech-News brief history (date selector + 🎯 holdings news + 📊 market news, sentiment-colored cards). Tools tab = hub (DCA/Monthly/Weekly/All Portfolio). Split into tabs so News no longer pushes Tools far down the scroll. Reads daily_news + daily_news_impact directly via Supabase.
dca           DCA Plan — multi-portfolio manual planner. Month selector (+ "+" to add next month) + portfolio tabs; per tab: budget input + 🔄 Refresh (gap-from-target suggestions), a TICKER/Reasoning/Suggested/Planned/Actual/✓ table, status pill (DRAFT→IN PROGRESS→COMPLETED→SUBMITTED) + progress bar. Action row: **Submit ✓** locks the month (`status:'submitted'` for every portfolio → inputs/checkboxes go read-only + SUBMITTED badge); **Export ⟨PortName⟩ to Sheets** / **📊 Export All Portfolios** append to per-portfolio tabs in the `MyAsset+ DCA History` spreadsheet via GAS `dcaExportSheet` (opens the sheet url). Submit and Export are independent — Export never clears/archives/rolls over; a new month is started only via ＋.
monthly       Monthly Review — trigger generateDCA
weekly        Weekly Review — trigger analyzeAll
allportfolio  All Portfolio — read-only AI signals across all holdings
settings      Profile, language, Telegram, GAS URL (theme toggle removed 2026-07-08 — light-only)
partner       Partner view (no nav entry; navigate('partner') directly)
```

Nav highlight logic:
- `nav-analysis` → analysis, monthly, weekly, allportfolio, dca
- `nav-more` → gold, **mf**, insurance, private, **bonds**, **loans**
- `nav-cash` → cash
- others → `nav-${page}`

## Key functions

### Home dashboard
- `loadDashboard()` — parallel fetch both users, renders hero + user cards + donut; asset summary is rendered by `_refreshDonut` (not by `loadDashboard` itself)
- `calcUserData(userId)` → `{ totalUSD, costBasisUSD, gainLossUSD, portfolios[], cashUSD, cashBreakdown, goldUSD, mfUSD, privateUSD, insuranceUSD, bondsUSD, cryptoUSD, otherUSD }`
- `switchDonutMode('me'|'combined')` — re-renders donut from `_dbCache` without re-fetching
- `_refreshDonut()` → `_renderAssetSummary(segments, totalUSD)` — 2-column card grid (`#db-port-summary`) below donut; one card per donut segment, percentages match exactly. **Note**: the old `#db-metrics` 2×2 grid (US Portfolio / Cash / Gold / Other) was removed 2026-06-20 — it was duplicate stale code.

### US Portfolio
- `loadUSPortfolio()` — caches the portfolio list in `_usPortfolios`, builds the tab strip (**`All` first**, then each portfolio, then `📊 Benchmark`), and calls `_computeUSCombinedMetrics` + `loadPortfolioTab(firstPortfolio)` in parallel. Default active tab is the **first real portfolio** (passes `.tab-btn[data-portfolio-id]`, not the `All` button)
- `_computeUSCombinedMetrics(portfolios)` — fetches all holdings + prev-day prices, returns combined value/cost/PL/dayChange
- `loadPortfolioTab(portfolioId, tabBtn)` — fetches one portfolio's holdings → `_renderHoldingsView`
- `loadAllPortfolioTab(tabBtn)` — the **`All`** tab: pulls holdings from every `_usPortfolios` entry, **merges duplicate tickers** (shares summed, avg cost = share-weighted average) → `_renderHoldingsView({isAll:true, portfolioId:null})`
- `_renderHoldingsView({holdings, portfolioName, portfolioId, isAll})` — shared render path for both loaders: computes totals, builds header (All = title + `+Add` only; real tab = rename + Analyze + Add), desktop `.pt-stats` + wide `.pt-table`, mobile Dime cards, sort/toggle bar; then `_renderPortTbody()` + `_renderUSMobileSummary()`; fires the batched `getPrices` live-refresh (re-render branches on `isAll`)
- `_renderUSMetricCards(metrics)` — fills the **desktop** 2-metric grid only (combined totals)
- `_renderUSMobileSummary(metrics)` — fills the **mobile** Dime summary card; re-rendered on every tab load so it shows the active tab's own totals (All = combined)
- `_renderPortTbody()` — emits the desktop `<tbody>` **and** the mobile `.ph-card.ph-dime` cards. Dime card: `.ph-d-left` (logo+ticker) taps → `openTickerDetail` modal; `.ph-d-right` (value+caret) taps → `_usToggleExpand` inline detail (Shares/Price/AVG Cost/Cost, one open at a time via `_usExpandedTk`). **Swipe** (real tabs only, `_swStart/_swMove/_swEnd`): left = `deleteHolding`, right = `openEditHolding`
- Desktop stats bar (`.pt-stats`) includes: Value · Cost · P/L · 1D Change · N positions. Mobile sub-total (`.pt-subtotal`) shows only **N positions** (the rest is in the summary card)
- **Ticker Detail modal** — tapping a `$ticker` in any holdings table calls `openTickerDetail(ticker)` (no navigation). Fetches GAS `getHistory`, then `_tdRender` builds a **header** (logo · ticker · name · price + day change) and a **horizontal scrollable pill tab bar** (`.td-tabbar` / `.td-tab`, TradingView-style, active = `--accent`): **Overview · Technicals · News · Earnings · Simulator**. Bottom-sheet modal (`#td-modal`), same pattern as gold/bond modals. Only the active tab's content is rendered into `#td-tab-content` — `_tdShowTab(tab)` swaps it. Shared state in `_tdCtx = {ticker, hist, g, price}`; each tab's async data is **lazy-loaded on first view**.
  - **Overview tab** (`_tdOverviewHtml` / `_tdFetchOverview`) — TradingView-style key-stats list (`.td-ov-row` label-left/value-right): Volume, Average volume (30D), Market cap, Dividend yield (indicated — only shown when > 0), P/E (TTM), Basic EPS (TTM), Net income (FY), Revenue (FY), Shares float, Beta (1Y), 52-week high/low. Data from **GAS `getOverview`** (Yahoo v10 quoteSummary — see GAS actions); cached per-ticker in `_tdOverview` (`{_error:true}` on failure → Thai "unavailable" message), `_tdOverviewToken` drops out-of-order fetches. Big numbers via `_tdFmtBig(v, cur)` (T/B/M/K, `$` when `cur`).
  - **Technicals tab** (`_tdTechnicalsHtml`, unchanged logic, just relocated): `_techRSI` (Wilder 14), `_techSMA` (20/50), `_techMACD` (12/26/9), combined by `_techGauge(closes)` into a score ∈ [−1,+1] → bucket `Strong Sell…Strong Buy`. `_tdGaugeSVG(score)` draws the 5-segment semicircle + needle. Validated on live NVDA (−0.46 → "Sell").
  - **News tab** (`_tdLoadNews`, unchanged): reads `daily_news` for the user `ilike` ticker, newest first, dedupes by headline similarity (`_tdNewsSimilar`, Jaccard ≥ 0.5), caps 5. Empty state in Thai. No live API — uses persisted brief only.
  - **Earnings tab** (`_tdEarningsHtml` / `_tdFetchEarnings`, cached in `_tdEarnings`) — a **next-earnings-date** card (from `calendarEvents`, relative "in Nd"/"Nd ago" via `_tdEarnDateLabel`) + the **last 4 quarters newest-first** as cards (`_tdEarnQuarterCard`): EPS estimate, EPS actual, Revenue, and a **Beat/Miss badge** with EPS surprise % (green beat / red miss, computed client-side from actual vs estimate). Data from **GAS `getEarnings`** → `_yahooEarnings` (Yahoo quoteSummary `earnings,earningsHistory,calendarEvents`) with a **Claude web-search fallback** (`_claudeEarnings`) only when Yahoo returns nothing. Empty state for ETFs/funds (no earnings). Yahoo has no historical revenue *estimate*, so the revenue cell shows the actual (estimate sub-line only appears via the Claude path); `{_error:true}` → Thai "unavailable" message. A **"ที่มา · Source:" footer** (`.td-earn-src`) shows provenance — `Yahoo Finance` or `Web search (Claude)` per `_tdEarnings.source`; the Overview tab carries the same footer (always Yahoo Finance).
  - **Simulator tab** (`_tdSimulatorHtml`, unchanged DCA logic, relocated): simulate adding to the position before buying. **Only renders when the user actually holds the ticker** — looks it up in `_portTableData` (current tab's rows, case-insensitive) for live shares + avg cost; otherwise a "not held" message. Amount input (USD, `inputmode=decimal`) + preset chips ($50/$100/$200/$500 via `_tdDcaSet`) recalc **live on every keystroke** (`_tdDcaCalc`, no submit). Shows Current → After for Shares / Avg Cost / Value / P/L % (`_tdDcaRows`), P/L color-coded; avg-cost **delta badge** under the new avg. Pure client-side math. State in `_tdDca`.
  - Globals/CSS: `_tdCtx` / `_tdTab` / `_tdOverview` / `_tdOverviewToken` / `_tdEarnings` / `_tdEarningsToken` / `_tdDca`; `.td-*` classes (incl. `.td-tabbar`/`.td-tab`/`.td-tabpane`/`.td-ov-*`/`.td-earn-*`/`.td-pane-msg`/`.td-dca-*`); functions prefixed `_tech*` / `_td*` / `openTickerDetail` / `closeTickerDetail` (the latter clears all per-ticker state).

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
- **Guess fund code** (under the Fund code field): `guessFundCode()` → GAS `mfGuessCode?q=` (Finnomena search) → tappable share-class list → `_pickFundCode(i)` fills `mf-fund-code`. Query = fund-name box, falling back to a partial code typed in the field. State in `_mfCodeResults`, cleared by `_mfModalReset`; reuses the `.mf-search-row*` styles. Pure convenience — never blocks save; the post-save fire-and-forget `refreshMFNav` then flips 🟡→🟢.
- **Find classes**: `lookupMFClasses()` → GAS `mfLookupClasses?projId=` → class dropdown (`_onMFClassSelect`). Use after pasting a proj_id manually.
- `openMFNavModal(id, name)` / `saveMFNav()` — "Update NAV" button stores `current_nav_thb` + `nav_updated_at` only (no `nav_date` — that's SEC-sourced).
- Top-bar ↻ → `refreshMFNav()` → GAS `refreshMFNav` → reloads page.
- Globals: `_mfListData`, `_mfEditId`, `_mfSortKey`, `_mfExpandedId`, `_mfCategory`, `_mfInputMethod`, `_mfType`, `_mfNavId`, `_mfSearchResults`, `_mfCodeResults`.

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

### Insurance (informational — excluded from net worth)
- `loadInsurance()` — fetches `insurance_policies`, renders a summary card + per-policy cards + add/edit modal. **Active = `status === 'in_force'`.** Summary: active count, annual premium commitment (`_insAnnualPremium` = `premium_amount_thb × _INS_FREQ[mode]`, summed over in-force only), and a ⏰ "due within 30 days" highlight (in-force policies whose `next_due_date` is 0–30 days out via `_daysTo`). Every render shows an "ℹ️ Informational only — not in net worth" note.
- Card: product name (`policy_name`) + `policy_type` badge + insurer/`policy_number`, status dot (`_INS_STATUS`: in_force=green / lapsed=red / matured=gray), 2-col grid (Sum Assured | Maturity, Premium + mode | Next Due), "Last paid: …" line, edit ✎ / delete 🗑.
- Modal (`#ins-modal`): policy-type pills (`setInsType`), insurer/number, product name (required → `policy_name`), insured + status, policy/maturity dates, sum assured, premium mode + amount (`_insRenderAnnual` live-previews the annualized total), payment method, next due, optional latest-payment (date/amount/method), notes. `saveIns()` is a pure DB insert/update; `openAddIns`/`openEditIns`/`closeInsModal`/`deleteIns`. Money fields use `_numInputFmt`/`_parseNum`.
- **EXCLUDED from net worth** — `calcUserData` no longer queries `insurance_policies`; the home donut "Insurance" segment was removed; `loadMore` shows the Asset-hub row as total annual premium (in-force) with no % and an "Informational · not in net worth" sublabel. Legacy `annual_premium_thb` / `surrender_value_thb` columns are untouched but unread.
- Globals/helpers: `_insEditId`, `_insType`, `_INS_FREQ` (payments/yr by mode), `_INS_STATUS`, `_insAnnualPremium`, `_esc` (shared HTML-escape). Reuses `_fmtShortDate` / `_daysTo` / `_numInputFmt` / `_parseNum` / `fmtTHB`.

### Asset hub (More page)
- `loadMore()` — fetches live THB values for all 5 asset types in parallel (gold, insurance, private, **MF**, bonds), renders each row as: icon + name | ฿value + % of subtotal | ›
- % is share of the five-asset subtotal (gold + insurance + private + MF + bonds), not total portfolio
- MF value = `units × current_nav_thb` (falls back to cost basis when NAV not set)
- **Loans row** is separate: shows total **outstanding** balance (principal − Σ paid) with a "Receivable · not in net worth" sublabel and **no %** — its value is never folded into the subtotal/`total` above.

### Loans (receivables)
- `loadLoans()` — fetches `loans` with embedded `loan_payments(*)`, renders the summary card (Total Remaining / Principal Lent / Expected Interest — **active = non-completed loans only**) + one `_renderLoanCard()` per loan. Resets to list view; shows the + button. All THB.
- **Status is fully derived from `paid_amount` vs `expected_amount` + today** (never trust the stored column for display). Per-installment `_loanPmtStatus(p)`: `paid` (paid ≥ expected) / `partial` (0 < paid < expected) / `overdue` (nothing paid & past due) / `pending`. Helpers: `_loanPaid`/`_loanExpected`/`_loanIsFullyPaid`/`_loanIsOverdue` (overdue = not-fully-paid & past due — flagged even on a `partial` row). `_loanStatus(loan, payments)`: `completed` when **whole principal collected** (Σ paid ≥ principal) / `overdue` (any overdue installment) / `active`. Loan colors `_LOAN_STATUS` (active=accent/blue, completed=muted/gray, overdue=danger/red); per-row colors `_LOAN_PMT_COLOR` (partial=**warning/orange**).
- **Partial payments** (option (b) — per-row running tally, no auto-roll-forward): `paid_amount` is the cumulative ฿ paid on the installment. `_loanPaidSum` = Σ paid across rows; loan **Remaining** = principal − Σ paid (reflects actual ฿ received, not just full-paid count); **Collected** = Σ paid; **Progress** = `_loanFullyPaidCount` (rows fully paid) / N, and the list progress bar tracks ฿ collected / principal.
- `_loanSchedule(loan)` — pure function: generates the installment rows (due date = `loan_date` + interval×i, expected = `installment_amount`). Interval months from `_loanInterval` (monthly=1, quarterly=3, custom=`custom_interval_months`). Used by both the modal live preview (`calcLoanSchedulePreview`) and persistence.
- `_syncLoanSchedule(loanId, loan)` — (re)builds the schedule on save **without losing paid history**: keeps every `paid` row, deletes all `pending` rows, re-inserts pending rows for installment numbers not already paid. Runs on both create and edit.
- Card: borrower + principal, remaining, progress bar, `X of N paid · ฿collected`, next pending payment (remaining due on the earliest not-fully-paid row), status badge. Tap card → `selectLoan(id)` master-detail view (`_renderLoanDetail`) with the full schedule checklist; `closeLoanDetail()` returns to the list.
- **Record Payment** (partial-aware, **increment** semantics): per-row button → `openLoanPay(id, expected, paidSoFar)` → `loanpay-modal` (shows "already paid", input prefilled with the **remaining due**, date defaults today) → `confirmLoanPay()` **adds** the entered amount to `paid_amount`, sets `paid_date` + `paid_at`, and flips `status` to `paid` once the tally reaches expected. **Reset ↺** (`unmarkLoanPay`) zeroes `paid_amount`/`paid_date`/`paid_at` → pending.
- **Editable due dates**: each row renders an inline `<input type="date">` (+ ✏️ hint) → `saveLoanDueDate(paymentId, newDate)` PATCHes that one row's `due_date` only — **never shifts the rest** (real-world renegotiation hits one payment at a time); overdue recomputes on re-render.
- Modal: `openAddLoan` / `openEditLoan` / `saveLoan` / `deleteLoan` (cascade-deletes payments). Frequency toggle `setLoanFreq` (monthly/quarterly/custom; custom reveals the interval field). `saveLoan` upserts the loan then calls `_syncLoanSchedule`.
- **Loans are excluded from net worth** — `loadLoans`/`loadMore` are the only readers; nothing wires into `calcUserData`/donut.
- Globals: `_loanEditId`, `_loanFreq`, `_selectedLoanId`, `_loanPayCtx` (`{paymentId, expected, already}`). Reuses `_numInputFmt` / `_parseNum` / `_fmtShortDate` / `_daysTo` / `fmtTHB` and the `.bond-back-btn` style.

### Analysis (News brief history)
- `anShowTab('news'|'tools')` — toggles the `[📰 News] [🛠️ Tools]` tab bar (active button + `.an-tab-pane` visibility). News is the default; the tab choice persists across `loadAnalysis()` refreshes (only the panes' classes change, not re-created). News pane wraps the date bar + `#analysis-news`; Tools pane wraps the DCA/Monthly/Weekly/All-Portfolio rows.
- `loadAnalysis()` — entry for the Analysis tab. Queries distinct `news_date` for `state.userId`, populates the date dropdown, defaults `_anDate` to **the most recent day that has news** (today if present, else latest; today is always kept selectable so an empty day shows "No news yet"), then `_anRenderDate()`.
- `_anRenderDate()` — fetches `daily_news` for the user+date with embedded `daily_news_impact(impact)` (PostgREST FK embed), ordered by `sort_order`; sets the ‹ older / newer › button disabled states; calls `_anPaint()`.
- `_anPaint()` — splits rows into 🎯 holdings (`is_holding_related`) + 📊 market sections, renders `_anCard()` for each. Honours the active `_anTickerFilter`.
- `_anCard(r)` — sentiment-colored card (`_anSentClass`: positive=green / negative=red / neutral=blue left border): emoji + clickable `$ticker` badge + headline + impact box (holdings only) + `ที่มา:` sources.
- Date nav: `anSelectDate(d)` (dropdown), `anStepDate(±1)` (‹/›). Ticker filter (nice-to-have): `anFilterTicker(t)` / `anClearFilter()` filter the loaded date's rows to one ticker.
- Helpers: `_anEsc` (HTML escape), `_bkkToday`, `_anDateLabel` (Today / Yesterday / date). Reads Supabase directly (anon read); no GAS call. The page is data-only — all writes come from `sendDailyNewsBrief()`.

### DCA Plan (multi-portfolio planner)
- `loadDCA()` — fetches `portfolios` (→ tabs, cached in `_dcaPorts` with `_bmEmoji`) + distinct `dca_plans.month_year` (→ month selector, always incl. current month); defaults `_dcaMonth`=current, `_dcaPortId`=first; renders the month bar + `#dca-tabs` + `#dca-tab-content` + `#dca-complete-wrap`, then `_dcaRenderActive()`.
- `_dcaRenderActive()` — for (`_dcaPortId`, `_dcaMonth`): loads the plan + its items, derives status (`_dcaDeriveStatus`, mirrored to DB), computes planned/actual/done sums, renders the header (month · status pill · budget input · Refresh), summary line, the 6-col table (each row: logo+ticker, reasoning, suggested, editable Planned/Actual inputs, ✓ checkbox), and the progress bar; then `_dcaUpdateCompleteBtn()`. When `plan.status==='submitted'` the plan is **locked**: inputs/checkboxes `disabled` (grayed), pill forced to SUBMITTED, and no derived-status DB write. When no plan exists, budget is prefilled from `_dcaPriorBudget` (latest prior month, else `portfolios.dca_budget_usd`).
- Tabs/month: `_dcaRenderTabs`, `_dcaSelectPort(id)`, `_dcaSelectMonth(m)`. `_dcaMonthLabel`/`_dcaThisMonth`/`_dcaFmtInput` helpers.
- `_dcaEnsurePlan()` — lazily inserts a `dca_plans` row (status draft, current budget) for the active tab; called by budget/refresh/edit handlers so nothing is written until the user acts.
- `_dcaRefresh()` — ensures the plan, saves budget, runs `_dcaGenerate(portId, budget)` (returns **every holding**: `currentPct=value/totalValue`, `gap=target-current`; only `gap>0` tickers split the budget ∝ gap, overweight → suggested 0 + "At/above" reasoning, no-target → suggested 0 + "No target % set"; sorted suggested-desc; Suggested non-editable), then `_dcaSyncItems(planId, generated)` **rebuilds Suggested/reasoning while preserving Planned/Actual/Done per ticker** (updates matches, deletes empty rows for tickers no longer held, inserts new).
- Cell edits: `_dcaEditItem(id, field, el)` (Planned/Actual, `_parseNum`), `_dcaToggleDone(id, el)` — each patches `dca_plan_items` then re-renders.
- `_dcaAddNextMonth()` — the **"+"** button: computes the month after the newest (`_dcaMonthAdd`), inserts a blank `dca_plans` row for the active portfolio (budget from `_dcaPriorBudget`, no items), sets `_dcaMonth` to it, reloads. The month then shows in the selector (which is built from distinct plan months).
- `_dcaUpdateCompleteBtn()` — queries all of the month's plans with embedded `dca_plan_items(is_done)` (+`portfolio_id`); when ≥1 item, renders the action row: **Submit ✓** (`.mark`, hidden→`✓ Submitted — locked` disabled once every plan is `submitted`), **Export ⟨PortName⟩ to Sheets** (`.submit`, only if the active tab has items → `_dcaExportSheet('<portId>')`), **📊 Export All Portfolios** (`_dcaExportSheet()`), + a note. `_dcaSubmitMonth()` PATCHes every plan for `_dcaMonth` to `status:'submitted'` then `_dcaRenderActive()` (locked). `_dcaExportSheet(portfolioId)` disables the row's buttons, `callGAS('dcaExportSheet', {userId, month[, portfolioId]})`; on failure toasts `❌ Export ไม่สำเร็จ — กรุณา re-authorize GAS ก่อน`; on success toasts `✅ Exported to Google Sheets — MyAsset+ DCA History` and `window.open`s `res.export.url` — **no clear/archive/rollover**; both paths rebuild via `_dcaUpdateCompleteBtn()`. (The old **📧 Submit & Email Summary**/`_dcaSubmitEmail` + **✅ Complete Month**/`_dcaCompleteMonth` were removed.)
- Globals: `_dcaMonth`, `_dcaPortId`, `_dcaPorts`, `_dcaMonths`, `_DCA_STATUS`. Reuses `_bmEmoji`/`_assetLogoImg`/`_numInputFmt`/`_parseNum`/`fmtUSD`/`_esc`. CSS `.dca-*` (monthbar/tabs/head/io/progress/complete). **Replaced the old `loadDCA`/`approveDCA` single-plan approval flow.**

### US Portfolio — Benchmark tab
- Lives on the **US Portfolio** page as the last `.tab-btn` in `#portfolio-tabs` (appended in `loadUSPortfolio` after the portfolio tabs). `showBenchmarkTab(btn)` sets it active, injects `_bmMarkup()` into `#portfolio-content`, then calls `initBenchmark()`. (`loadPortfolioTab` clears all tab-btn active states, so switching back to a portfolio de-activates it.)
- `_bmMarkup()` — returns the benchmark section HTML (title `Benchmark Comparison`, Thai subtitle, pill container, Timescale/Timeframe segments pre-marked from `_bmScale`/`_bmTf`, chart card). Re-injected fresh on every tab click.
- `initBenchmark()` — fetches this user's `portfolios` **once** (cached in `_bmPorts` as `{id,name,emoji}` via `_bmEmoji`), drops stale ids from `_bmSel` but otherwise keeps the selection across tab switches, renders pills, `renderBenchmark()`.
- `renderBenchmark()` — the pipeline: aggregate `shares` per ticker across the selected portfolios (`_bmSelectedIds`) → `symbols = ['^GSPC','^IXIC',...tickers]` → `callGAS('benchmarkHistory', {symbols, range:_bmRange(), interval:_bmScale})` → build master date axis from `^GSPC` → `_bmAlignSeries` (align each symbol to master keys, forward/back-fill) → portfolio series `Σ shares×close` per date (`_bmFfill`) → `_bmNorm` (÷base×100) → `_bmRenderChart`. A `_bmReqSeq` counter drops out-of-order async results.
- Selectors: `bmTogglePort(id)` (`'total'` = all; picking specifics starts a `Set`, never leaves nothing selected), `bmSetScale`/`bmSetTf` (update `_bmScale`/`_bmTf`, re-render). `_bmRange()` clamps `1m` interval → `5d` (Yahoo minute-data limit).
- Keying/labels: `_bmKey(t)` buckets by UTC date for daily (aligns index vs stock timestamps) / raw ts for intraday; `_bmLabel(t)` for x-axis.
- `_bmRenderChart(d)` — destroys/rebuilds the `bm-chart` Chart.js line (3 dashed datasets: NASDAQ `_BM_NASDAQ` #eab308, S&P `_BM_SP` #14b8a6, portfolio `_BM_PORT` #22d3ee), index-mode tooltip `value (±%)`, custom `#bm-legend`.
- Globals: `_bmScale`, `_bmTf`, `_bmPorts`, `_bmSel` (`'total'` | `Set<id>`), `_bmReqSeq`. CSS: `.bm-title`/`.bm-sub`/`.bm-lbl`/`.bm-pill`/`.bm-seg-btn`/`.bm-chart-*`/`.bm-legend`. Only reader of `benchmarkHistory`.

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

> **Warm cream, light-theme-only (redesigned 2026-07-08).** Full token spec, hexes, font justification, and component mapping live in **`DESIGN.md`** (repo root) — that is the source of truth. Summary below.

```css
/* :root — warm cream tokens (the only theme; dark mode removed) */
--bg: #f6e9cf        /* cream page background */
--primary: #558467   /* sage — buttons, active tab/nav, CTAs, positive P/L */
--accent: #b8684f    /* terracotta — badges, alerts, negative P/L */
--s1: #eee0c5        /* cards */   --s2: #e5d4b0  /* inputs, card interiors */
--text: #1a1a1a      --muted: #7a6e5f   --text-inv: #ffffff
--border: rgba(85,132,103,0.2)
--g: #558467 (positive)   --r: #b8684f (negative)
--font: 'IBM Plex Sans Thai','Noto Sans Thai',-apple-system,…
/* legacy aliases kept: --surface→s1, --surface2→s2, --success→g, --danger→r,
   --text-muted→muted, --warning→#c9922e gold. --accent2 removed. */
```

- **Naming gotcha**: the old `--accent` (blue) was the *action* color → globally renamed to `var(--primary)` (sage). The new `--accent` is terracotta. So **buttons/active states use `--primary`, not `--accent`.**
- **Charts**: warm categorical palette — sage / terracotta / muted-gold `#c9922e` / dusty-blue `#6b8cae` / warm-tan `#d9b382` / olive `#8a9a5b`; P/L sage/terracotta.

Key classes:
- `.card` / `.card2` — primary / secondary card
- `.g2x` / `.g4x` — 2 or 4-column grid
- `.m-lbl` / `.m-val` / `.m-sub` — metric label/value/subtitle (body font)
- `.mono` — table numbers (now Instrument Sans; JetBrains Mono removed 2026-06-29)
- `.pt-table` / `.pt-mono` / `.pt-ticker` — portfolio table cells (desktop). Below 768px the table is hidden and the **Dime-style holding cards** render instead: `.ph-cards` / `.ph-card.ph-dime` → `.ph-swipe-bg` (edit/del reveal) + `.ph-d-body` (swipe layer) → `.ph-d-main` (`.ph-d-left` logo+ticker+`⊕`weight → modal; `.ph-d-right` value+`.ph-d-caret`+secondary → toggle expand) + collapsible `.ph-d-detail` (`.ph-d-detgrid` Shares/Price/AVG Cost/Cost). The older `.ph-card-top`/`-id`/`-tk`/`-price`/`-shares`/`-row`/`-actions` classes still exist for other card layouts. `_renderPortTbody` emits both the `<tbody>` and `#pt-cards`; CSS `@media(max-width:767px)` toggles `.pt-card .tbl-wrap`↔`.pt-card .ph-cards`. Mobile show/hide rules are scoped under `#us-metrics-wrap`/`.pt-card` parents so they out-specify the later base defs
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
- `.mf-search-row` / `.mf-search-row-name` / `.mf-search-row-sub` / `.mf-search-row-pid` — SEC fund search **and** Finnomena code-guess result rows
- `.an-datebar` / `.an-date-select` / `.an-date-nav` — Analysis page date selector + ‹/› nav
- `.an-section-title` — Analysis section headers (🎯 / 📊)
- `.an-tabbar` / `.an-tab` (`.active`) / `.an-tab-pane` (`.active`) — Analysis News/Tools tab bar + panes (`anShowTab('news'|'tools')`; `#an-pane-news` holds the date bar + `#analysis-news`, `#an-pane-tools` holds the tool rows)
- `.an-card` (`.pos` / `.neg` / `.neu`) / `.an-card-head` / `.an-emoji` / `.an-ticker` / `.an-headline` / `.an-impact` / `.an-impact-lbl` / `.an-sources` — News brief cards (sentiment-colored left border)
- `.an-filter-pill` — active ticker-filter chip (tap to clear)
- `.td-head` / `.td-tk` / `.td-name` / `.td-price` / `.td-chg` — Ticker Detail modal header (Syne ticker + mono price)
- `.td-tabbar` / `.td-tab` (`.active`) / `.td-tabpane` — Ticker Detail modal tab bar (scrollable pills) + per-tab pane wrapper
- `.td-ov-row` / `.td-ov-lbl` / `.td-ov-val` — Overview tab key-stats rows (label left / value right); `.td-pane-msg` — centered empty/placeholder message (not-held, load-fail, ETF-no-earnings)
- `.td-earn-next*` / `.td-earn-q` / `.td-earn-qhead` / `.td-earn-qlbl` / `.td-earn-badge` (`.beat`/`.miss`/`.na`) / `.td-earn-grid` / `.td-earn-cell*` — Earnings tab (next-date card + per-quarter EPS/revenue cards + Beat/Miss badge)
- `.td-sec-lbl` — section label inside the modal (Technicals / Latest News / Simulator)
- `.td-gauge-wrap` / `.td-gauge-verdict` / `.td-gauge-sub` — technicals gauge container + verdict text
- `.td-ind-row` / `.td-ind` / `.td-ind-lbl` / `.td-ind-val` / `.td-ind-tag` — per-indicator breakdown cards (RSI / MA / MACD)
- `.td-news-item` / `.td-news-hl` / `.td-news-emoji` / `.td-news-meta` / `.td-news-empty` / `.td-news-load` — modal news rows + empty/loading states
- `.td-stats` / `.td-stat` / `.td-stat-lbl` / `.td-stat-val` — quick-stats grid (52wk H/L, P/E, mkt cap)
- `.td-dca-input-wrap` / `.td-dca-sign` / `.td-dca-input` / `.td-dca-presets` / `.td-dca-preset` — DCA simulator amount input + preset chips
- `.td-dca-head` / `.td-dca-row` / `.td-dca-col-lbl` / `.td-dca-lbl` / `.td-dca-cur` / `.td-dca-new` / `.td-dca-arrow` / `.td-dca-delta` — DCA simulator Current → After comparison grid + avg-cost delta badge
- `.td-loading` / `.td-spin` — modal loading spinner while `getHistory` resolves
- `.tk-logo` / `.tk-logo-img` / `.tk-light` / `.tk-dark` / `.tk-fill` / `.tk-badge` — asset-logo circular badge + per-logo background variants (see **Asset logos**)
- `.pt-ticker-wrap` — flex wrapper (logo + `$ticker`) in holdings table cells

## Thai bank config

`THAI_BANKS` embedded inline in `index.html` (19 banks). Helper: `_bankLogoImg(code, size)` → `<img>` with circular crop + brand-color border. Logos in `assets/banks/{CODE}.png`.

## Asset logos (US stocks / ETFs / crypto / gold)

Logo icons next to every `$ticker` in the holdings tables, the **Ticker Detail modal** header, and a generic fund icon on **Mutual Fund** cards. Same dual pattern as the banks: `src/config/assetLogos.js` is the canonical ES-module reference (`STOCK_LOGOS` / `ISSUER_LOGOS` / `ETF_LOGOS` / `MISC_LOGOS` → flattened `ASSET_LOGOS`), mirrored **inline** in `index.html` as `const ASSET_LOGOS` (the inline copy is what runs; the module is not imported). Keep the two in sync.

- **Paths are relative** (`assets/logos/...`, no leading slash) so they resolve under the GitHub Pages project subpath. (The mirror file uses leading-slash paths to match `banks.js` — cosmetic only.)
- **Sources** (downloaded once, committed): US stock logos from `davidepalazzo/ticker-logos` (`ticker_icons/<TICKER>.png`, ALL-CAPS); crypto + gold from `nvstly/icons` (`crypto_icons/`, `forex_icons/XAU.png`). Files stored UPPERCASE to match the ticker key (GitHub Pages is case-sensitive).
  - `assets/logos/us-stocks/<TICKER>.png` — individual brand logos (Growth + blue-chip/dividend stocks, plus O/MAIN REIT/BDC).
  - `assets/logos/issuers/<issuer>.png` — fund-**issuer** brands. `ticker-logos` has no per-ETF art (its "VTI.png" is just the Vanguard wordmark, "SCHD.png" the Schwab logo, "JEPI.png" the Chase octagon), so ETFs map to one consistent issuer logo: `vanguard` (VTI/VOO/VT/VXUS/BND/VHT/VNQ/VPU), `schwab` (SCHD/SCHG), `jpmorgan` (JEPI/JEPQ + the JPM stock), `invesco` (QQQ/**SPHD** — SPHD is an Invesco fund, not SPDR), `blackrock` (SGOV, iShares brand). Issuer files sourced from each issuer's own stock ticker (SCHW/JPM/IVZ/BLK); vanguard from the repo's VTI.png.
  - `assets/logos/misc/` — `BTC.png`, `ETH.png`, `XAU.png` (gold; **GLD** = SPDR Gold Shares reuses it), `fund.svg` (generic mutual-fund glyph, hand-made).
- **Helpers** (`index.html`): `_assetLogoImg(ticker, size)` returns a logo in a circular badge `<span>`, else `_tkBadge()` (deterministic colored **initials badge** — the only fallback for an unmapped ticker; never breaks the UI). `_fundLogoImg(size)` for the generic fund icon. `_tkBadgeEl()` is the DOM-node version used by `<img onerror>` to swap a broken logo for a badge.
- **Per-logo badge background** (`_logoStyle` + `LOGO_LIGHT` / `LOGO_FILL` sets, picked from measured logo brightness so contrast is correct in **both** light and dark theme, identical in each):
  - `.tk-light` = white badge — dark/colored logos (most).
  - `.tk-dark` = dark badge — white-on-transparent logos (`LOGO_LIGHT`: AAPL, AMZN, MAIN, RKLB, ABBV, MS, SGOV; + the white fund glyph).
  - `.tk-fill` = full-bleed tile fills the circle (`LOGO_FILL`: GLD, XAU).
- **Sizing gotcha**: the `<img>` is sized `width/height:84%` of the badge and flex-centered. Do **NOT** use CSS `padding:%` on `.tk-logo` — % padding resolves against the parent cell's width (not the badge), which collapsed the image to a dot (fixed 2026-06-27).
- Single render path: all US tabs (Growth/Dividend/ETF) go through `_renderPortTbody()` — there is no per-tab logo code. To add coverage for a new holding, just add the ticker to `ASSET_LOGOS` (and `LOGO_LIGHT` if it's a white logo). Current map covers all 30 live holdings.

## Thai AMC logos (mutual fund cards)

Mutual funds have no per-fund artwork, so each MF card is badged by its issuing **AMC** (asset-management company), derived from the fund-code/name prefix — added 2026-06-30, replacing the old generic black fund glyph.

- **Resolution**: `_mfAmc(h)` (in `index.html`) reads `h.fund_code || h.sec_fund_class_name || h.fund_name`, uppercases, and matches a prefix → AMC key. Order matters (KKP before K-, KT- before K-): `KKP`→kkp, `KT-`/`KTAM`→ktam, `ES-`→eastspring, `1AM`/`ONE-`→one, `PRINCIPAL`→principal, `UOB`→uob, `TISCO`/`TG`/`TE`→tisco, `K-`/`KPLAN`→kasikorn. (`TG`/`TE` are TISCO — e.g. TGSMARTRMF, TEGRMF; confirmed via Finnomena.)
- **Map**: `AMC_LOGOS` (inline `const` in `index.html`, mirrored in `src/config/assetLogos.js` — keep in sync) → `assets/logos/amc/*.png`.
- **Sources**: 5 bank-affiliated AMCs **reuse the bank brand logos**, copied from `assets/banks/` (KKP→`kkp.png`, KBANK→`kasikorn.png`, TISCO→`tisco.png`, UOB→`uob.png`, KTB→`ktam.png`). **Eastspring** = its double-chevron mark cropped/trimmed from the Wikimedia Commons `Eastspring Investments.png` wordmark (the wide wordmark itself is illegible in a circle). **Principal** = the white-P blue-gradient apple-touch-icon from principal.com.
- **Badge style** (same `.tk-logo` system as asset logos): `tk-light` (white badge) for all except `AMC_LOGO_DARK` = `{kkp}` (pale logo → dark badge) and `AMC_LOGO_FILL` = `{principal}` (full-bleed colored tile, `object-fit:cover`). Verified in both themes.
- **Fallback**: an AMC with no logo renders a **colored initials badge** (`_tkBadge` — the same deterministic badge unmapped stock tickers use), never a broken/blank slot or the old generic glyph. Badge text comes from `_fundBadgeLabel(h, amc)` = `AMC_LABEL[amc]` (known AMC, so every fund of that AMC shares one badge) → AMC key → `fund_code`/`fund_name`. **ONE Asset Management** (`1AM-`/`ONE-`) resolves to `amc='one'`, has no `AMC_LOGOS` entry (only a low-res wordmark exists), and `AMC_LABEL.one='ONE'` → both ONE funds show a purple **"ON"** badge. To upgrade to a real logo later: drop a clean square logo at `assets/logos/amc/one.png`, add the `one:` line to both `AMC_LOGOS` copies, and remove the `AMC_LABEL.one` entry.
- Coverage: 21 of 23 live holdings logo'd; the 2 ONE funds show the "ON" initials badge. `assets/logos/misc/fund.svg` is now unused.

## App icon

Source: `assets/icons/M+ V7.svg` (editable master, committed). Exported PNGs in `assets/icons/`: `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` (192/512 are `purpose: any maskable`). 1024 raster master at `assets/icon-source.png`. Wired in `index.html` head (`<link rel="icon">` 16/32, `<link rel="apple-touch-icon">` 180, `apple-mobile-web-app-title`) + `manifest.json` `icons` array.

**Regen pipeline** (no rsvg/imagemagick/inkscape on this machine — only `sips` + Python `PIL`):
1. `qlmanage -t -s 1024 -o . "M+ V7.svg"` renders a **1024px master**. Gotcha: qlmanage rasterizes onto an **opaque white** background (the PNG has an alpha channel but every pixel is opaque), so a plain alpha-flatten is a no-op.
2. **Flood-fill** the connected white background from all four corners to `#f6e9cf` via `PIL.ImageDraw.floodfill(im, xy, (246,233,207), thresh=60)`. This recolors only the outer background — the off-white "M+" lettering enclosed inside the brown wallet is untouched (it's not corner-connected).
3. `Image.resize(..., LANCZOS)` to each size.

Background `#f6e9cf` matches the app `theme_color`/`background_color` (manifest) + `<meta name="theme-color">`. Bump SW cache only when `index.html` itself changes (icons aren't SW-cached; browsers cache favicons hard — hard-refresh / re-add iOS home-screen shortcut to see updates).

## Service worker

Cache name: **`myasset-v105`**. Bump on every `index.html` change.

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
