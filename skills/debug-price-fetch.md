# Skill: Debug Price Fetch Issues

Checklist for diagnosing wrong, zero, stale, or missing prices.

---

## Symptoms → where to look

| Symptom | First place to check |
|---|---|
| Price shows 0 or `—` | `market_data` table — see if a row exists |
| Price is stale (old date) | `market_data.fetched_at` — GAS trigger may not be running |
| Price is wrong (vs TradingView) | GAS execution log — which source won? |
| Gold specifically wrong | Run `testGoldPrice()` in GAS IDE |
| Frontend shows old price after GAS ran | `getLatestPrice()` fetches `order=fetched_at.desc&limit=1` — check if insert succeeded |

---

## Step 1 — Check the DB directly

In Supabase SQL Editor:
```sql
SELECT symbol, price, fetched_at
FROM market_data
WHERE symbol = 'XAU'   -- or SP500, USDTHB, ticker, etc.
ORDER BY fetched_at DESC
LIMIT 5;
```

Expected: row with `fetched_at` within the last 24 hours and a sane price.

Common findings:
- **No rows at all** → GAS `fetchData` has never run successfully
- **Rows exist but old** → GAS daily trigger is broken; check Apps Script triggers
- **Rows exist, recent, wrong price** → source returned bad data; check GAS log

---

## Step 2 — Check GAS execution log

In GAS IDE: **View → Executions**. Find the most recent `onDailyTrigger` or manual `fetchAll` run.

What to look for in the log (`Logger.log` output):

```
[DataAgent] Stooq HTTP 200: ...        ← source attempted
[DataAgent] Gold price: $XXXX/oz [source: stooq.com]   ← success
[DataAgent] Gold fetch FAILED — all four sources returned no valid price   ← all failed
```

Each source logs its HTTP response code and the first 120–200 chars of the body. A 403/429/0 means the source is blocking GAS server IPs.

---

## Step 3 — Run the standalone test

For gold specifically, run from GAS IDE (no trigger needed):

```js
testGoldPrice()
```

This calls `_fetchGoldSpotPrice()` directly and logs which source succeeded + the price. Compare against TradingView `XAUUSD`.

For other prices, run:
```js
DataAgent.fetchAll()
```

Then check Executions log.

---

## Step 4 — Check the source chain

**Gold (`XAU`)** — four-source chain in `DataAgent._fetchGoldSpotPrice()`:
1. Stooq.com CSV (`xauusd`) — most reliable from GAS IPs
2. GLD ETF ÷ 0.093252 via Yahoo Finance — equity ticker, more reliable than forex
3. goldprice.org — may be blocked by Google IPs
4. metals.live — may be blocked by Google IPs

Each source validates: `price > 1000 && price < 10000`. If a source returns `N/D` or a value out of range, it logs the raw value and tries the next source.

**Yahoo Finance forex** (`XAUUSD=X`, `THB=X`) — unreliable from GAS server IPs. Equity/ETF tickers are preferred; forex symbols are a known failure mode.

**AIMC mutual fund NAVs** — scraped via `https://www.thaimutualfund.com`. If funds show 0, the HTML structure may have changed; check `_fetchMutualFundNAV()` in DataAgent.gs.

**CoinGecko crypto** — uses the public `/api/v3/simple/price` endpoint (no key). Rate-limited; if 429, add a `Utilities.sleep(1000)` between calls.

---

## Step 5 — Check frontend `getLatestPrice()`

In `index.html`, `getLatestPrice(symbol)` queries:
```js
sb.from('market_data').select('price').eq('symbol', symbol)
  .order('fetched_at', { ascending: false }).limit(1)
```

There is **no unique constraint** on `market_data` — multiple rows per symbol are normal. If `fetched_at` ordering isn't working, the wrong row may be returned. Verify in SQL that the most recent row has the expected price.

---

## Step 6 — GAS trigger health

In GAS IDE: **Triggers** (clock icon). Verify:
- `onDailyTrigger` → Time-driven, Day timer, 8–9 AM
- `onRealtimeTrigger` → Time-driven, Minutes timer, every 5 minutes

If triggers are missing, run `setupTriggers()` once from the IDE. Do not re-run it without deleting existing triggers first (it creates duplicates).

---

## Step 7 — Force a fresh fetch

From the Settings page in the app, tap **Refresh Market Data** (calls GAS `fetchData` action). Or from GAS IDE run `DataAgent.fetchAll()` manually and check Executions.

After fetching, reload the relevant page in the app — `loadGold()` / `loadUSPortfolio()` etc. re-query the DB on every navigation.
