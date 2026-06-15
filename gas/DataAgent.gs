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
    const result = _fetchGoldSpotPrice();
    if (!result) return;
    _upsertMarketData('XAU', 'gold', result.price, 'USD');
    Logger.log(`[DataAgent] Gold price: $${result.price}/oz  [source: ${result.source}]`);
  }

  // Returns { price, source } or null.
  // Priority: Stooq.com → GLD ETF÷0.093252 → goldprice.org → metals.live
  // Each source logs HTTP code + raw body so failures are visible in execution log.
  function _fetchGoldSpotPrice() {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // 1. Stooq.com — CSV, no key, reliable from GAS server IPs
    try {
      const r = UrlFetchApp.fetch(
        'https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv',
        { muteHttpExceptions: true, headers: { 'User-Agent': UA } }
      );
      const code = r.getResponseCode();
      const body = r.getContentText();
      Logger.log('[DataAgent] Stooq HTTP ' + code + ': ' + body.substring(0, 120));
      if (code === 200) {
        const lines = body.trim().split('\n');
        // Header: Symbol,Date,Time,Open,High,Low,Close,Volume
        // Data:   XAUUSD,20260610,150000,4200.00,4215.00,4195.00,4207.50,0
        if (lines.length >= 2) {
          const headers = lines[0].split(',');
          const vals    = lines[1].split(',');
          const closeIdx = headers.indexOf('Close');
          if (closeIdx >= 0) {
            const price = parseFloat(vals[closeIdx]);
            if (price > 1000 && price < 10000) {
              return { price, source: 'stooq.com' };
            }
            Logger.log('[DataAgent] Stooq: Close=' + vals[closeIdx] + ' (out of range or N/D)');
          }
        }
      }
    } catch (e) {
      Logger.log('[DataAgent] Stooq exception: ' + e.message);
    }

    // 2. GLD ETF ÷ 0.093252  (Yahoo equity far more reliable than Yahoo forex)
    //    1 GLD share = 0.093252 troy oz as of 2024; so gold = GLD / 0.093252
    try {
      const data = _yahooQuote('GLD');
      const gld = data?.regularMarketPrice;
      Logger.log('[DataAgent] GLD quote: ' + gld);
      if (gld > 50 && gld < 2000) {
        const price = parseFloat((gld / 0.093252).toFixed(2));
        if (price > 1000 && price < 10000) {
          return { price, source: 'GLD÷0.093252 (GLD=$' + gld + ')' };
        }
      }
    } catch (e) {
      Logger.log('[DataAgent] GLD fallback exception: ' + e.message);
    }

    // 3. goldprice.org with Referer header (may be blocked by Google IPs)
    try {
      const r = UrlFetchApp.fetch('https://data-asg.goldprice.org/dbXRates/USD', {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://goldprice.org/'
        }
      });
      const code = r.getResponseCode();
      const body = r.getContentText();
      Logger.log('[DataAgent] goldprice.org HTTP ' + code + ': ' + body.substring(0, 200));
      if (code === 200) {
        const data  = JSON.parse(body);
        const price = data?.items?.[0]?.xauPrice;
        if (price > 1000 && price < 10000) {
          return { price: parseFloat(price.toFixed(2)), source: 'goldprice.org' };
        }
        Logger.log('[DataAgent] goldprice.org: xauPrice=' + price + ' (out of range or missing)');
      }
    } catch (e) {
      Logger.log('[DataAgent] goldprice.org exception: ' + e.message);
    }

    // 4. metals.live (may be blocked by Google IPs)
    try {
      const r = UrlFetchApp.fetch('https://metals.live/api/spot?metals=gold', {
        muteHttpExceptions: true,
        headers: { 'User-Agent': UA, 'Accept': 'application/json' }
      });
      const code = r.getResponseCode();
      const body = r.getContentText();
      Logger.log('[DataAgent] metals.live HTTP ' + code + ': ' + body.substring(0, 200));
      if (code === 200) {
        const data  = JSON.parse(body);
        const entry = Array.isArray(data) ? data.find(function(x) { return x.metal === 'gold'; }) : null;
        const price = entry?.price;
        if (price > 1000 && price < 10000) {
          return { price: parseFloat(price.toFixed(2)), source: 'metals.live' };
        }
        Logger.log('[DataAgent] metals.live: price=' + price + ' (out of range or missing)');
      }
    } catch (e) {
      Logger.log('[DataAgent] metals.live exception: ' + e.message);
    }

    Logger.log('[DataAgent] Gold fetch FAILED — all four sources returned no valid price');
    return null;
  }

  // Public: fetch live spot price, save to DB, return { price, source } for web app action
  function fetchGoldPrice() {
    const result = _fetchGoldSpotPrice();
    if (!result) return null;
    _upsertMarketData('XAU', 'gold', result.price, 'USD');
    Logger.log(`[DataAgent] fetchGoldPrice: $${result.price}/oz  [source: ${result.source}]`);
    return result;
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

  // ── Thai Mutual Fund NAV (SEC Open Data v2 API + thaifundstoday.com fallback) ─
  //
  // Base URL : https://api.sec.or.th
  // Auth     : header  Ocp-Apim-Subscription-Key: {SEC_API_KEY}
  // Endpoints:
  //   GET /v2/fund/general-info/profiles?proj_abbr_name={code}  → fund metadata
  //   GET /v2/fund/daily-info/nav?proj_abbr_name={code}         → latest daily NAV
  //   GET /v2/fund/general-info/amcs                            → AMC directory

  var SEC_BASE = 'https://api.sec.or.th';

  /** Helper: GET a SEC v2 endpoint, return parsed body or null */
  function _secGet(path, apiKey) {
    try {
      var resp = UrlFetchApp.fetch(SEC_BASE + path, {
        muteHttpExceptions: true,
        headers: { 'Ocp-Apim-Subscription-Key': apiKey }
      });
      var code = resp.getResponseCode();
      if (code !== 200) {
        Logger.log('[SEC] ' + path + ' → HTTP ' + code);
        return null;
      }
      return JSON.parse(resp.getContentText());
    } catch (e) {
      Logger.log('[SEC] fetch error ' + path + ': ' + e.message);
      return null;
    }
  }

  /** Unwrap API response: handles plain array, {data:[...]}, or single object */
  function _secUnwrap(raw) {
    if (!raw) return null;
    if (Array.isArray(raw))             return raw.length ? raw[0] : null;
    if (raw.data && Array.isArray(raw.data)) return raw.data.length ? raw.data[0] : null;
    return raw; // single object
  }

  /** Public entry point — called by fetchAll() and the daily 8 AM trigger */
  function fetchThaiMutualFunds() {
    Logger.log('[DataAgent] fetchThaiMutualFunds started');
    _fetchMutualFundNAV();
    Logger.log('[DataAgent] fetchThaiMutualFunds complete');
  }

  function _fetchMutualFundNAV() {
    var funds = supabaseRequest('GET', 'mutual_fund_holdings?select=fund_code');
    if (!funds || funds.length === 0) return;

    var today = _dateStr();
    var seen  = {};
    funds.forEach(function(f) { if (f.fund_code) seen[f.fund_code] = true; });
    var uniqueCodes = Object.keys(seen);

    uniqueCodes.forEach(function(code) {
      try {
        var result = _fetchSECNav(code);
        if (!result || !(result.nav > 0)) return;

        var nav     = result.nav;
        var navDate = result.date || today;

        // Keep market_data current for dashboard / calcUserData / loadMore
        _upsertMarketData(code, 'mutual_fund', nav, 'THB');

        // Persist in mutual_fund_nav for history + 1-day change
        supabaseUpsert('mutual_fund_nav?on_conflict=fund_code,nav_date', {
          fund_code: code,
          nav_date:  navDate,
          nav_price: nav
        });

        Logger.log('[DataAgent] ' + code + ' NAV: ฿' + nav + ' (' + navDate + ')');
      } catch (e) {
        Logger.log('[DataAgent] NAV fetch error for ' + code + ': ' + e.message);
      }
    });
  }

  /**
   * Fetch latest NAV for one fund.
   * Strategy:
   *   1. SEC v2  GET /v2/fund/daily-info/nav?proj_abbr_name={code}  (direct, no projId needed)
   *   2. SEC v2  profile lookup → projId → GET /v2/fund/daily-info/nav?proj_id={id}
   *   3. Scrape  thaifundstoday.com
   * Returns { nav: Number, date: 'YYYY-MM-DD' } or null.
   */
  function _fetchSECNav(fundCode) {
    var apiKey = Config.SEC_API_KEY();

    if (apiKey) {
      // 1. Direct query by abbreviation name (fastest path)
      var direct = _secFetchNavByAbbrName(fundCode, apiKey);
      if (direct) return direct;

      // 2. Look up projId (cache first, then API), then re-query NAV by projId
      var master = supabaseRequest('GET',
        'mutual_fund_master?fund_code=eq.' + encodeURIComponent(fundCode) +
        '&select=sec_proj_id&limit=1');
      var projId = (master && master[0]) ? master[0].sec_proj_id : null;

      if (!projId) projId = _secFetchProfile(fundCode, apiKey); // also caches metadata

      if (projId) {
        var byId = _secFetchNavByProjId(projId, apiKey);
        if (byId) return byId;
      }
    }

    // 3. Fallback scrape
    return _fetchThaiFundsTodayNav(fundCode);
  }

  /**
   * GET /v2/fund/daily-info/nav?proj_abbr_name={code}
   * Returns { nav, date } or null.
   */
  function _secFetchNavByAbbrName(fundCode, apiKey) {
    var raw  = _secGet('/v2/fund/daily-info/nav?proj_abbr_name=' + encodeURIComponent(fundCode), apiKey);
    return _secParseNavEntry(raw);
  }

  /**
   * GET /v2/fund/daily-info/nav?proj_id={projId}
   * Returns { nav, date } or null.
   */
  function _secFetchNavByProjId(projId, apiKey) {
    var raw = _secGet('/v2/fund/daily-info/nav?proj_id=' + encodeURIComponent(projId), apiKey);
    return _secParseNavEntry(raw);
  }

  /** Parse a NAV API response (array or wrapped) into { nav, date } */
  function _secParseNavEntry(raw) {
    var item = _secUnwrap(raw);
    if (!item) return null;
    // Field names: snake_case (v2) or camelCase (legacy) — support both
    var nav = parseFloat(
      item.nav        || item.nav_value      || item.navValue ||
      item.last_val   || item.lastVal        ||
      item.value      || item.net_asset_value || 0
    );
    if (!(nav > 0)) return null;
    return {
      nav:  nav,
      date: item.nav_date || item.navDate || _dateStr()
    };
  }

  /**
   * GET /v2/fund/general-info/profiles?proj_abbr_name={code}
   * Caches result in mutual_fund_master.
   * Returns projId string or null.
   */
  function _secFetchProfile(fundCode, apiKey) {
    try {
      var raw  = _secGet('/v2/fund/general-info/profiles?proj_abbr_name=' + encodeURIComponent(fundCode), apiKey);
      var item = _secUnwrap(raw);
      if (!item) return null;

      var projId = String(
        item.proj_id || item.projId || item.fund_id || item.fundId || ''
      );
      if (!projId) return null;

      // Persist metadata so we avoid repeat lookups
      supabaseUpsert('mutual_fund_master?on_conflict=fund_code', {
        fund_code:    item.proj_abbr_name || item.projAbbrName || fundCode,
        fund_name:    item.proj_name_en   || item.projNameEng  || null,
        fund_name_th: item.proj_name_th   || item.projNameTh   || null,
        amc:          item.amc_name_th    || item.amcNameTh    ||
                      item.comp_name      || item.compName     || null,
        sec_proj_id:  projId,
        scraped_at:   new Date().toISOString()
      });

      return projId;
    } catch (e) {
      Logger.log('[DataAgent] _secFetchProfile failed for ' + fundCode + ': ' + e.message);
      return null;
    }
  }

  /**
   * Fallback: scrape thaifundstoday.com for NAV.
   * Returns { nav, date } or null.
   */
  function _fetchThaiFundsTodayNav(fundCode) {
    try {
      var url  = 'https://thaifundstoday.com/funds/' + encodeURIComponent(fundCode);
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) return null;

      var html  = resp.getContentText();
      var match = html.match(/nav[^<"]{0,80}?([\d]{1,6}\.[\d]{4})/i)
                || html.match(/>[\s]*([\d]{1,6}\.[\d]{4})[\s]*<\/td>/);
      if (match) {
        var nav = parseFloat(match[1]);
        if (nav > 0) return { nav: nav, date: _dateStr() };
      }
      return null;
    } catch (e) {
      Logger.log('[DataAgent] ThaiFundsToday scrape failed for ' + fundCode + ': ' + e.message);
      return null;
    }
  }

  /**
   * Called from Code.gs action=searchMFFund (frontend "Search" button).
   * Uses GET /v2/fund/general-info/profiles?proj_abbr_name={code}.
   * Returns fund info object for the frontend or null.
   */
  function searchSECFund(fundCode) {
    var apiKey = Config.SEC_API_KEY();
    if (!apiKey) return null;

    try {
      var raw  = _secGet('/v2/fund/general-info/profiles?proj_abbr_name=' + encodeURIComponent(fundCode), apiKey);
      var item = _secUnwrap(raw);
      if (!item) return null;

      var projId = String(
        item.proj_id || item.projId || item.fund_id || item.fundId || ''
      );
      var code = item.proj_abbr_name || item.projAbbrName || fundCode;

      if (projId) {
        supabaseUpsert('mutual_fund_master?on_conflict=fund_code', {
          fund_code:    code,
          fund_name:    item.proj_name_en || item.projNameEng  || null,
          fund_name_th: item.proj_name_th || item.projNameTh   || null,
          amc:          item.amc_name_th  || item.amcNameTh    ||
                        item.comp_name    || item.compName     || null,
          sec_proj_id:  projId,
          scraped_at:   new Date().toISOString()
        });
      }

      return {
        fundCode:   code,
        fundName:   item.proj_name_en || item.projNameEng  || null,
        fundNameTh: item.proj_name_th || item.projNameTh   || null,
        amc:        item.amc_name_th  || item.amcNameTh    ||
                    item.comp_name    || item.compName     || null,
        projId:     projId || null
      };
    } catch (e) {
      Logger.log('[DataAgent] searchSECFund failed: ' + e.message);
      return null;
    }
  }

  /**
   * Search SEC database by fund name (Thai or English).
   * Called from Code.gs action=matchMFFund after a user saves a new holding.
   * Returns { fundCode, fundName, fundNameTh, amc, projId } or null.
   */
  function matchSECFundByName(fundName) {
    var apiKey = Config.SEC_API_KEY();
    if (!apiKey) return null;

    try {
      var encoded = encodeURIComponent(fundName);

      // Try the dedicated funds search endpoint first
      var raw = _secGet('/v2/fund/general-info/funds?fund_name=' + encoded, apiKey);

      // Fallback: profiles endpoint with English name query
      if (!raw || _secIsEmpty(raw)) {
        raw = _secGet('/v2/fund/general-info/profiles?proj_name_en=' + encoded, apiKey);
      }
      // Fallback: profiles with Thai name
      if (!raw || _secIsEmpty(raw)) {
        raw = _secGet('/v2/fund/general-info/profiles?proj_name_th=' + encoded, apiKey);
      }
      // Fallback: profiles with abbreviation
      if (!raw || _secIsEmpty(raw)) {
        raw = _secGet('/v2/fund/general-info/profiles?proj_abbr_name=' + encoded, apiKey);
      }

      // Fallback: try individual keywords (≥4 chars) from the fund name
      // Handles cases where the stored name differs slightly (e.g. "Balance" vs "Balanced")
      if (!raw || _secIsEmpty(raw)) {
        var SKIP = { fund: 1, the: 1, and: 1, for: 1 };
        var keywords = fundName.split(/\s+/).filter(function(w) {
          return w.length >= 4 && !SKIP[w.toLowerCase()];
        });
        for (var ki = 0; ki < keywords.length; ki++) {
          var kw = _secGet('/v2/fund/general-info/funds?fund_name=' + encodeURIComponent(keywords[ki]), apiKey);
          if (kw && !_secIsEmpty(kw)) { raw = kw; break; }
        }
      }

      var items = Array.isArray(raw)          ? raw
                : (raw && raw.data)           ? raw.data
                : (raw && raw.proj_id)        ? [raw]
                : [];

      if (!items.length) return null;

      // Pick best match: prefer where name contains search term
      var q = fundName.toLowerCase();
      var best = items.find(function(item) {
        var en   = (item.proj_name_en   || item.projNameEng   || '').toLowerCase();
        var th   = (item.proj_name_th   || item.projNameTh    || '').toLowerCase();
        var abbr = (item.proj_abbr_name || item.projAbbrName  || '').toLowerCase();
        return en.includes(q) || th.includes(q) || abbr.includes(q)
               || q.includes(en.slice(0, 10));
      }) || items[0];

      var projId = String(best.proj_id || best.projId || '');
      var code   = best.proj_abbr_name || best.projAbbrName || null;

      // Cache in mutual_fund_master
      if (code) {
        supabaseUpsert('mutual_fund_master?on_conflict=fund_code', {
          fund_code:    code,
          fund_name:    best.proj_name_en || best.projNameEng || null,
          fund_name_th: best.proj_name_th || best.projNameTh  || null,
          amc:          best.amc_name_th  || best.amcNameTh   ||
                        best.comp_name    || best.compName    || null,
          sec_proj_id:  projId || null,
          scraped_at:   new Date().toISOString()
        });
      }

      return {
        fundCode:   code,
        fundName:   best.proj_name_en || best.projNameEng || null,
        fundNameTh: best.proj_name_th || best.projNameTh  || null,
        amc:        best.amc_name_th  || best.amcNameTh   ||
                    best.comp_name    || best.compName    || null,
        projId:     projId || null
      };
    } catch (e) {
      Logger.log('[DataAgent] matchSECFundByName failed: ' + e.message);
      return null;
    }
  }

  /** True when a raw API response is empty (no results). */
  function _secIsEmpty(raw) {
    if (!raw) return true;
    if (Array.isArray(raw))      return raw.length === 0;
    if (raw.data)                return raw.data.length === 0;
    return false;
  }

  /**
   * Fetch and persist NAV for a single fund code immediately.
   * Called after a successful name→code match so the card shows live NAV
   * without waiting for the next daily 8 AM trigger.
   */
  function fetchNavForSingleFund(fundCode) {
    try {
      var today  = _dateStr();
      var result = _fetchSECNav(fundCode);
      if (!result || !(result.nav > 0)) return;

      _upsertMarketData(fundCode, 'mutual_fund', result.nav, 'THB');
      supabaseUpsert('mutual_fund_nav?on_conflict=fund_code,nav_date', {
        fund_code: fundCode,
        nav_date:  result.date || today,
        nav_price: result.nav
      });
      Logger.log('[DataAgent] fetchNavForSingleFund ' + fundCode + ': ฿' + result.nav);
    } catch (e) {
      Logger.log('[DataAgent] fetchNavForSingleFund error for ' + fundCode + ': ' + e.message);
    }
  }

  /**
   * Standalone test — run from GAS IDE to verify SEC API connectivity.
   * Usage: testSECApi()  → logs profile + NAV for a sample fund.
   */
  function testSECApi() {
    var apiKey = Config.SEC_API_KEY();
    if (!apiKey) { Logger.log('[testSECApi] SEC_API_KEY not set'); return; }

    // AMC list sanity check
    var amcs = _secGet('/v2/fund/general-info/amcs', apiKey);
    Logger.log('[testSECApi] AMC list: HTTP ' + (amcs ? 'OK, ' + (Array.isArray(amcs) ? amcs.length : (amcs.data || []).length) + ' AMCs' : 'FAILED'));

    // Test with a known large fund (KKP US500-UH)
    var testCode = 'KKP US500-UH';
    Logger.log('[testSECApi] Profile for ' + testCode + ':');
    var profile = _secGet('/v2/fund/general-info/profiles?proj_abbr_name=' + encodeURIComponent(testCode), apiKey);
    Logger.log(JSON.stringify(profile));

    Logger.log('[testSECApi] NAV for ' + testCode + ':');
    var nav = _secGet('/v2/fund/daily-info/nav?proj_abbr_name=' + encodeURIComponent(testCode), apiKey);
    Logger.log(JSON.stringify(nav));

    // Also test KKOREPATH to diagnose Bug 1
    var testCode2 = 'KKOREPATH';
    Logger.log('[testSECApi] NAV direct for ' + testCode2 + ':');
    var nav2 = _secGet('/v2/fund/daily-info/nav?proj_abbr_name=' + encodeURIComponent(testCode2), apiKey);
    Logger.log(JSON.stringify(nav2));
    Logger.log('[testSECApi] Profile for ' + testCode2 + ':');
    var profile2 = _secGet('/v2/fund/general-info/profiles?proj_abbr_name=' + encodeURIComponent(testCode2), apiKey);
    Logger.log(JSON.stringify(profile2));
    Logger.log('[testSECApi] mutual_fund_nav rows for ' + testCode2 + ':');
    var navRows = supabaseRequest('GET', 'mutual_fund_nav?fund_code=eq.' + testCode2 + '&order=nav_date.desc&limit=5');
    Logger.log(JSON.stringify(navRows));
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

    const result = _fetchGoldSpotPrice();
    if (!result) return;

    // Compare against yesterday's saved price for % change (goldprice.org has no built-in % change)
    const todayISO = new Date().toISOString().slice(0, 10);
    const prevRows = supabaseRequest('GET',
      `market_data?select=price&symbol=eq.XAU&fetched_at=lt.${todayISO}T00:00:00Z&order=fetched_at.desc&limit=1`);
    const prevPrice = prevRows?.[0]?.price;
    if (!prevPrice) return;

    const changePct = ((result.price - prevPrice) / prevPrice) * 100;
    if (Math.abs(changePct) >= 5) {
      golds.forEach(g => {
        alerts.push({
          type: 'gold_alert',
          user_id: g.user_id,
          symbol: 'XAU/USD',
          price: result.price,
          change_pct: changePct,
          window: '1d'
        });
      });
    }
  }

  function _checkSRProximityAlerts(alerts) {
    const srRows = supabaseRequest('GET', 'sr_levels?select=ticker,support,resistance,created_at&order=created_at.desc');
    if (!srRows || srRows.length === 0) return;

    const srMap = {};
    srRows.forEach(r => { if (!srMap[r.ticker]) srMap[r.ticker] = r; });

    // Use CacheService to track last-check prices for minimum price move filter
    const cache = CacheService.getScriptCache();

    Object.entries(srMap).forEach(([ticker, sr]) => {
      const data = _yahooQuote(ticker);
      if (!data) return;
      const price = data.regularMarketPrice;

      // Require >1% price move since last 5-min check to avoid repeat firing
      const cacheKey = `sr_lastprice_${ticker}`;
      const lastPriceStr = cache.get(cacheKey);
      cache.put(cacheKey, String(price), 3600);
      if (lastPriceStr) {
        const lastPrice = parseFloat(lastPriceStr);
        if (Math.abs((price - lastPrice) / lastPrice) < 0.01) return;
      }

      // Alert when price is within ±1% of S/R level
      const nearSupport    = sr.support    && Math.abs((price - sr.support)    / sr.support)    <= 0.01;
      const nearResistance = sr.resistance && Math.abs((price - sr.resistance) / sr.resistance) <= 0.01;

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

  function savePrice(symbol, price, assetType, currency) {
    _upsertMarketData(symbol, assetType || 'stock', price, currency || 'USD');
  }

  // ── Dynamic S/R calculation ─────────────────────────────────────────────────

  function _yahoo90DayData(ticker) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`;
      const resp = _fetchJSON(url);
      const result = resp?.chart?.result?.[0];
      if (!result) return null;
      return {
        meta:   result.meta,
        highs:  (result.indicators?.quote?.[0]?.high  || []).filter(p => p != null),
        lows:   (result.indicators?.quote?.[0]?.low   || []).filter(p => p != null)
      };
    } catch (e) {
      Logger.log(`[DataAgent] 90-day data failed for ${ticker}: ${e.message}`);
      return null;
    }
  }

  function _getRoundLevels(price) {
    let step;
    if      (price < 10)   step = 1;
    else if (price < 50)   step = 5;
    else if (price < 200)  step = 10;
    else if (price < 500)  step = 25;
    else if (price < 2000) step = 50;
    else                   step = 100;
    const base = Math.floor(price / step) * step;
    return [base - step, base, base + step, base + step * 2].filter(l => l > 0);
  }

  function _calculateDynamicSR(ticker) {
    const hist = _yahoo90DayData(ticker);
    if (!hist || hist.highs.length < 10) return null;

    const { meta, highs, lows } = hist;
    const price      = meta.regularMarketPrice;
    const week52High = meta.fiftyTwoWeekHigh;
    const week52Low  = meta.fiftyTwoWeekLow;

    // Swing highs/lows with a 3-candle window on each side
    const WIN = 3;
    const swingHighs = [];
    const swingLows  = [];
    for (let i = WIN; i < highs.length - WIN; i++) {
      if (highs.slice(i - WIN, i).every(h => h <= highs[i]) &&
          highs.slice(i + 1, i + WIN + 1).every(h => h <= highs[i])) {
        swingHighs.push(highs[i]);
      }
      if (lows.slice(i - WIN, i).every(l => l >= lows[i]) &&
          lows.slice(i + 1, i + WIN + 1).every(l => l >= lows[i])) {
        swingLows.push(lows[i]);
      }
    }

    const roundLevels = _getRoundLevels(price);

    // Nearest level strictly above / below current price (+0.5% buffer to exclude current)
    const resistanceCandidates = [
      ...swingHighs.filter(h => h > price * 1.005),
      (week52High > price * 1.005 ? week52High : null),
      ...roundLevels.filter(l => l > price)
    ].filter(Boolean).sort((a, b) => a - b);

    const supportCandidates = [
      ...swingLows.filter(l => l < price * 0.995),
      (week52Low  < price * 0.995 ? week52Low  : null),
      ...roundLevels.filter(l => l < price)
    ].filter(Boolean).sort((a, b) => b - a);

    return {
      support:    supportCandidates[0]    != null ? parseFloat(supportCandidates[0].toFixed(2))    : null,
      resistance: resistanceCandidates[0] != null ? parseFloat(resistanceCandidates[0].toFixed(2)) : null
    };
  }

  // Called weekly to refresh S/R for all held tickers using dynamic calculation
  function updateDynamicSRLevels() {
    const rows = supabaseRequest('GET', 'holdings?select=ticker');
    if (!rows || rows.length === 0) return;

    const tickers = [...new Set(rows.map(r => r.ticker))];
    Logger.log(`[DataAgent] Updating dynamic S/R for ${tickers.length} tickers`);

    tickers.forEach(ticker => {
      const sr = _calculateDynamicSR(ticker);
      if (!sr || (!sr.support && !sr.resistance)) return;
      try {
        supabaseRequest('POST', 'sr_levels', {
          ticker:     ticker,
          support:    sr.support,
          resistance: sr.resistance,
          timeframe:  'weekly',
          created_at: new Date().toISOString()
        });
        Logger.log(`[DataAgent] ${ticker}: S=${sr.support}, R=${sr.resistance}`);
      } catch (e) {
        Logger.log(`[DataAgent] S/R update failed for ${ticker}: ${e.message}`);
      }
    });
  }

  // ── Bond info scraper ─────────────────────────────────────────────────────

  /**
   * Scrape bond metadata from ThaiBMA website for a given bond code.
   * Checks bond_master cache first; scrapes and caches on miss.
   * Returns bond info object or null if lookup fails.
   */
  function scrapeBondInfo(bondCode) {
    // 1. Check cache
    try {
      const cached = supabaseRequest('GET', `bond_master?bond_code=eq.${encodeURIComponent(bondCode)}&limit=1`);
      if (cached && cached.length > 0) {
        Logger.log(`[DataAgent] Bond ${bondCode}: returning cached info`);
        return cached[0];
      }
    } catch (e) {
      Logger.log(`[DataAgent] Bond cache lookup failed: ${e.message}`);
    }

    // 2. Scrape ThaiBMA EN page
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const url = `https://www.thaibma.or.th/EN/BondInfo/BondFeature/Issue.aspx?symbol=${encodeURIComponent(bondCode)}`;
    let html = '';
    try {
      const r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
      });
      const code = r.getResponseCode();
      Logger.log(`[DataAgent] ThaiBMA HTTP ${code} for ${bondCode}`);
      if (code !== 200) return null;
      html = r.getContentText();
    } catch (e) {
      Logger.log(`[DataAgent] ThaiBMA fetch failed: ${e.message}`);
      return null;
    }

    // 3. Parse fields using regex (ThaiBMA ASP.NET table structure)
    function extract(patterns) {
      for (const rx of patterns) {
        const m = html.match(rx);
        if (m && m[1] && m[1].trim() && m[1].trim() !== '&nbsp;') return m[1].trim();
      }
      return null;
    }

    const bondName     = extract([
      /(?:Bond Name|Security Name|Instrument Name)[^<]*<\/[^>]+>\s*<td[^>]*>([^<]{5,})<\/td>/i,
      /<span[^>]*id="[^"]*lblBondName[^"]*"[^>]*>([^<]+)<\/span>/i,
      /<td[^>]*class="[^"]*BondName[^"]*"[^>]*>([^<]+)<\/td>/i
    ]);
    const issuer       = extract([
      /(?:Issuer|Issuer Name)[^<]*<\/[^>]+>\s*<td[^>]*>([^<]{2,})<\/td>/i,
      /<span[^>]*id="[^"]*lblIssuer[^"]*"[^>]*>([^<]+)<\/span>/i
    ]);
    const creditRating = extract([
      /(?:Credit Rating|Rating)[^<]*<\/[^>]+>\s*<td[^>]*>([A-Za-z0-9+\-()]+(?:\([a-z]+\))?)<\/td>/i,
      /<span[^>]*id="[^"]*lblRating[^"]*"[^>]*>([^<]+)<\/span>/i,
      /Rating\s*<\/td>\s*<td[^>]*>\s*([A-Za-z0-9+\-()]+)\s*<\/td>/i
    ]);
    const couponRateRaw = extract([
      /(?:Coupon Rate|Interest Rate)[^<]*<\/[^>]+>\s*<td[^>]*>([\d.]+)\s*%?<\/td>/i,
      /<span[^>]*id="[^"]*lblCoupon[^"]*"[^>]*>([\d.]+)<\/span>/i
    ]);
    const couponTypeRaw = extract([
      /(?:Coupon Frequency|Payment Frequency|Coupon Type)[^<]*<\/[^>]+>\s*<td[^>]*>([^<]+)<\/td>/i,
      /<span[^>]*id="[^"]*lblFrequency[^"]*"[^>]*>([^<]+)<\/span>/i
    ]);
    const issuedDateRaw  = extract([
      /(?:Issue Date|Issued Date)[^<]*<\/[^>]+>\s*<td[^>]*>([\d\/\-\w]+)<\/td>/i,
      /<span[^>]*id="[^"]*lblIssueDate[^"]*"[^>]*>([^<]+)<\/span>/i
    ]);
    const maturityDateRaw = extract([
      /(?:Maturity Date)[^<]*<\/[^>]+>\s*<td[^>]*>([\d\/\-\w]+)<\/td>/i,
      /<span[^>]*id="[^"]*lblMaturity[^"]*"[^>]*>([^<]+)<\/span>/i
    ]);

    // Normalise coupon type to our standard values
    function normaliseCouponType(raw) {
      if (!raw) return 'semi-annually';
      const r = raw.toLowerCase();
      if (r.includes('semi') || r.includes('bi-ann') || r.includes('2')) return 'semi-annually';
      if (r.includes('quarter') || r.includes('4'))                        return 'quarterly';
      if (r.includes('month') || r.includes('12'))                         return 'monthly';
      return 'annually';
    }

    // Parse a date string like "30/06/2023", "30-Jun-2023", "2023-06-30"
    function parseThaiDate(raw) {
      if (!raw) return null;
      const dd_mm_yyyy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dd_mm_yyyy) return `${dd_mm_yyyy[3]}-${dd_mm_yyyy[2].padStart(2,'0')}-${dd_mm_yyyy[1].padStart(2,'0')}`;
      const d_mon_yyyy = raw.match(/^(\d{1,2})[\/\- ]([A-Za-z]{3,})[\/\- ](\d{4})$/);
      if (d_mon_yyyy) {
        const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                         jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
        const mo = months[d_mon_yyyy[2].substring(0,3).toLowerCase()] || '01';
        return `${d_mon_yyyy[3]}-${mo}-${d_mon_yyyy[1].padStart(2,'0')}`;
      }
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return raw;
      return null;
    }

    const couponRate  = couponRateRaw  ? parseFloat(couponRateRaw)  : null;
    const couponType  = normaliseCouponType(couponTypeRaw);
    const issuedDate  = parseThaiDate(issuedDateRaw);
    const maturityDate = parseThaiDate(maturityDateRaw);

    // Need at least the bond name to be useful
    if (!bondName && !issuer) {
      Logger.log(`[DataAgent] Bond ${bondCode}: could not parse any fields from ThaiBMA`);
      return null;
    }

    const info = {
      bond_code:     bondCode,
      bond_name:     bondName,
      issuer:        issuer,
      credit_rating: creditRating,
      coupon_rate:   couponRate,
      coupon_type:   couponType,
      issued_date:   issuedDate,
      maturity_date: maturityDate,
      scraped_at:    new Date().toISOString()
    };

    // 4. Cache in bond_master (upsert on primary key bond_code)
    try {
      supabaseUpsert('bond_master?on_conflict=bond_code', info);
      Logger.log(`[DataAgent] Bond ${bondCode} cached in bond_master`);
    } catch (e) {
      Logger.log(`[DataAgent] bond_master upsert failed: ${e.message}`);
    }

    return info;
  }

  return { fetchAll, checkRealtimeAlerts, savePrice, updateDynamicSRLevels, fetchGoldPrice, scrapeBondInfo, fetchThaiMutualFunds, searchSECFund, matchSECFundByName, fetchNavForSingleFund, testSECApi };
})();

// ── Standalone test runners (visible in GAS function picker) ──────────────────

function testFetchAll()          { DataAgent.fetchAll(); }
function testFetchRate()         { Logger.log('[test] Fetching USD/THB rate only'); DataAgent.fetchAll(); }
function testRealtimeAlerts()    {
  const alerts = DataAgent.checkRealtimeAlerts();
  Logger.log('[test] ' + alerts.length + ' alert(s): ' + JSON.stringify(alerts));
}
function testUpdateSRLevels()    { DataAgent.updateDynamicSRLevels(); }
function testGoldPrice()         {
  const result = DataAgent.fetchGoldPrice();
  Logger.log('[testGoldPrice] result: ' + JSON.stringify(result));
}
function testBondScrape()        {
  const result = DataAgent.scrapeBondInfo('SCB276A');
  Logger.log('[testBondScrape] result: ' + JSON.stringify(result));
}
