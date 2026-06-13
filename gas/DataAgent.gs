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

  return { fetchAll, checkRealtimeAlerts, savePrice, updateDynamicSRLevels, fetchGoldPrice, scrapeBondInfo };
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
