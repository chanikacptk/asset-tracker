/**
 * DataAgent.gs — Market data fetching
 * Sources: Yahoo Finance, CoinGecko, AIMC (NAV scrape), SET via Yahoo
 */

const DataAgent = (() => {

  // ── Public API ──────────────────────────────────────────────────────────────

  function fetchAll() {
    Logger.log('[DataAgent] fetchAll started');
    _fetchUsdThbRate();
    _fetchStocksAndETF();
    _fetchGold();
    _fetchBenchmarks();
    _fetchCrypto();
    _fetchMutualFundNAV();
    Logger.log('[DataAgent] fetchAll complete');
  }

  /**
   * Called every 5 minutes. Returns array of alert objects for triggered thresholds.
   */
  function checkRealtimeAlerts() {
    const alerts = [];
    _checkCryptoAlerts(alerts);
    _checkGoldAlert(alerts);
    _checkSRProximityAlerts(alerts);
    return alerts;
  }

  // ── USD/THB rate ────────────────────────────────────────────────────────────

  function _fetchUsdThbRate() {
    const data = _yahooQuote('THB=X');
    if (!data) return;
    const rate = data.regularMarketPrice;
    const today = _dateStr();
    supabaseUpsert('exchange_rates?on_conflict=from_currency,to_currency,date', {
      from_currency: 'USD',
      to_currency: 'THB',
      rate: rate,
      date: today
    });
    Logger.log(`[DataAgent] USD/THB: ${rate}`);
  }

  // ── Stocks & ETF ────────────────────────────────────────────────────────────

  function _fetchStocksAndETF() {
    // Collect all unique tickers from all portfolios
    const rows = supabaseRequest('GET', 'holdings?select=ticker,portfolios(type)');
    if (!rows || rows.length === 0) return;

    const tickers = [...new Set(rows.map(r => r.ticker))];
    tickers.forEach(ticker => {
      const data = _yahooQuote(ticker);
      if (!data) return;
      _upsertMarketData(ticker, 'stock', data.regularMarketPrice, 'USD');
      Logger.log(`[DataAgent] ${ticker}: $${data.regularMarketPrice}`);
    });

    // Also fetch watchlist tickers (for news, not portfolio)
    const wl = supabaseRequest('GET', 'watchlist?select=ticker');
    if (wl) {
      [...new Set(wl.map(r => r.ticker))].forEach(ticker => {
        const data = _yahooQuote(ticker);
        if (data) _upsertMarketData(ticker, 'stock', data.regularMarketPrice, 'USD');
      });
    }
  }

  // ── Gold ────────────────────────────────────────────────────────────────────

  function _fetchGold() {
    const data = _yahooQuote('GC=F');
    if (!data) return;
    _upsertMarketData('XAU', 'gold', data.regularMarketPrice, 'USD');
    Logger.log(`[DataAgent] Gold: $${data.regularMarketPrice}`);
  }

  // ── Benchmarks (S&P500, SET Index) ─────────────────────────────────────────

  function _fetchBenchmarks() {
    const benchmarks = [
      { symbol: '^GSPC', key: 'SP500', type: 'index' },
      { symbol: '^SET.BK', key: 'SET', type: 'index' }
    ];
    benchmarks.forEach(b => {
      const data = _yahooQuote(b.symbol);
      if (data) {
        _upsertMarketData(b.key, b.type, data.regularMarketPrice, b.key === 'SET' ? 'THB' : 'USD');
      }
    });
  }

  // ── Crypto ──────────────────────────────────────────────────────────────────

  function _fetchCrypto() {
    const rows = supabaseRequest('GET', 'crypto_holdings?select=coin_id,symbol');
    if (!rows || rows.length === 0) return;

    const ids = rows.map(r => r.coin_id).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const resp = _fetchJSON(url);
    if (!resp) return;

    rows.forEach(row => {
      const entry = resp[row.coin_id];
      if (!entry) return;
      _upsertMarketData(row.symbol.toUpperCase(), 'crypto', entry.usd, 'USD');
      Logger.log(`[DataAgent] ${row.symbol}: $${entry.usd} (24h: ${entry.usd_24h_change?.toFixed(2)}%)`);
    });
  }

  // ── Thai Mutual Fund NAV (AIMC scrape) ──────────────────────────────────────

  function _fetchMutualFundNAV() {
    const funds = supabaseRequest('GET', 'mutual_fund_holdings?select=fund_code');
    if (!funds || funds.length === 0) return;

    funds.forEach(f => {
      const nav = _fetchAIMCNav(f.fund_code);
      if (nav !== null) {
        _upsertMarketData(f.fund_code, 'mutual_fund', nav, 'THB');
        Logger.log(`[DataAgent] ${f.fund_code} NAV: ฿${nav}`);
      }
    });
  }

  function _fetchAIMCNav(fundCode) {
    try {
      // AIMC public NAV search endpoint
      const url = `https://www.aimc.or.th/en/nav/?fund=${encodeURIComponent(fundCode)}`;
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) return null;

      const html = resp.getContentText();
      // Parse NAV value from HTML table — look for the fund code row
      // Pattern: fund code followed by NAV number in table cell
      const pattern = new RegExp(fundCode + '[^<]*<[^>]+>[^<]*<[^>]+>([\\d,]+\\.\\d+)');
      const match = html.match(pattern);
      if (match) {
        return parseFloat(match[1].replace(/,/g, ''));
      }
      return null;
    } catch (e) {
      Logger.log(`[DataAgent] AIMC fetch failed for ${fundCode}: ${e.message}`);
      return null;
    }
  }

  // ── Real-time alert checks ──────────────────────────────────────────────────

  function _checkCryptoAlerts(alerts) {
    const rows = supabaseRequest('GET', 'crypto_holdings?select=coin_id,symbol,user_id');
    if (!rows || rows.length === 0) return;

    const ids = rows.map(r => r.coin_id).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_1hr_change=true`;
    const resp = _fetchJSON(url);
    if (!resp) return;

    rows.forEach(row => {
      const entry = resp[row.coin_id];
      if (!entry) return;
      const change1h = entry.usd_1h_change || 0;
      if (Math.abs(change1h) >= 5) {
        alerts.push({
          type: 'crypto_alert',
          user_id: row.user_id,
          symbol: row.symbol.toUpperCase(),
          price: entry.usd,
          change_pct: change1h,
          window: '1h'
        });
      }
    });
  }

  function _checkGoldAlert(alerts) {
    const golds = supabaseRequest('GET', 'gold_holdings?select=user_id');
    if (!golds || golds.length === 0) return;

    const data = _yahooQuote('GC=F');
    if (!data) return;

    const changePct = data.regularMarketChangePercent || 0;
    if (Math.abs(changePct) >= 5) {
      golds.forEach(g => {
        alerts.push({
          type: 'gold_alert',
          user_id: g.user_id,
          symbol: 'XAU/USD',
          price: data.regularMarketPrice,
          change_pct: changePct,
          window: '1d'
        });
      });
    }
  }

  function _checkSRProximityAlerts(alerts) {
    // Check if any stock price is within 2% of its latest support or resistance
    const srRows = supabaseRequest('GET', 'sr_levels?select=ticker,support,resistance,created_at&order=created_at.desc');
    if (!srRows || srRows.length === 0) return;

    // Deduplicate: latest S/R per ticker
    const srMap = {};
    srRows.forEach(r => {
      if (!srMap[r.ticker]) srMap[r.ticker] = r;
    });

    Object.entries(srMap).forEach(([ticker, sr]) => {
      const data = _yahooQuote(ticker);
      if (!data) return;
      const price = data.regularMarketPrice;
      const nearSupport = sr.support && Math.abs((price - sr.support) / sr.support) <= 0.02;
      const nearResistance = sr.resistance && Math.abs((price - sr.resistance) / sr.resistance) <= 0.02;

      if (nearSupport || nearResistance) {
        alerts.push({
          type: 'sr_alert',
          symbol: ticker,
          price: price,
          level: nearSupport ? sr.support : sr.resistance,
          level_type: nearSupport ? 'support' : 'resistance'
        });
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _yahooQuote(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const resp = _fetchJSON(url);
      return resp?.chart?.result?.[0]?.meta || null;
    } catch (e) {
      Logger.log(`[DataAgent] Yahoo quote failed for ${symbol}: ${e.message}`);
      return null;
    }
  }

  function _fetchJSON(url) {
    try {
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (resp.getResponseCode() !== 200) return null;
      return JSON.parse(resp.getContentText());
    } catch (e) {
      Logger.log(`[DataAgent] fetchJSON failed: ${url} → ${e.message}`);
      return null;
    }
  }

  function _upsertMarketData(symbol, assetType, price, currency) {
    supabaseRequest('POST', 'market_data', {
      symbol: symbol,
      asset_type: assetType,
      price: price,
      currency: currency,
      fetched_at: new Date().toISOString()
    });
  }

  function _dateStr() {
    return new Date().toISOString().slice(0, 10);
  }

  return { fetchAll, checkRealtimeAlerts };
})();

// ── Standalone test runners (visible in GAS function picker) ──────────────────

function testFetchAll()          { DataAgent.fetchAll(); }
function testFetchRate()         { Logger.log('[test] Fetching USD/THB rate only'); DataAgent.fetchAll(); }
function testRealtimeAlerts()    {
  const alerts = DataAgent.checkRealtimeAlerts();
  Logger.log('[test] ' + alerts.length + ' alert(s): ' + JSON.stringify(alerts));
}
