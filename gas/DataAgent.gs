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

  // ── Mutual Fund NAV (SEC Open Data v2) ──────────────────────────────────────
  // Phase 2: optional, additive, NEVER throws into a user path. A failed refresh
  // logs and skips — it never clears or overwrites a manually-entered NAV.

  const SEC_NAV_URL      = 'https://api.sec.or.th/v2/fund/daily-info/nav';
  const SEC_PROFILES_URL = 'https://api.sec.or.th/v2/fund/general-info/profiles';

  /**
   * GET a SEC Open Data v2 endpoint and return ALL rows, following next_cursor pagination.
   * SEC v2 wraps rows in { message, page_size, next_cursor, items: [...] }.
   * Returns [] on any missing key / non-200 / parse error (never throws).
   */
  function _secApiItems(url, tag) {
    const key = Config.SEC_API_KEY();
    if (!key) { Logger.log('[SEC] ' + tag + ': SEC_API_KEY not set — skipping'); return []; }
    const all = [];
    let nextUrl = url;
    let page = 0;
    try {
      while (nextUrl && page < 10) {
        page++;
        const r = UrlFetchApp.fetch(nextUrl, {
          method: 'get',
          headers: { 'Ocp-Apim-Subscription-Key': key, 'Accept': 'application/json' },
          muteHttpExceptions: true
        });
        const code = r.getResponseCode();
        const body = r.getContentText() || '';
        if (code !== 200) { Logger.log('[SEC] ' + tag + ' p' + page + ' HTTP ' + code + ': ' + body.substring(0, 200)); break; }
        const j = JSON.parse(body);
        const items = Array.isArray(j) ? j
                    : Array.isArray(j.items) ? j.items
                    : Array.isArray(j.data)  ? j.data
                    : [j];
        all.push.apply(all, items);
        const cursor = j.next_cursor;
        nextUrl = cursor ? url + '&next_cursor=' + encodeURIComponent(cursor) : null;
      }
      if (page > 1) Logger.log('[SEC] ' + tag + ' fetched ' + all.length + ' rows across ' + page + ' pages');
    } catch (e) {
      Logger.log('[SEC] ' + tag + ' fetch/parse error: ' + e.message);
    }
    return all;
  }

  /**
   * Fetch raw NAV rows for a proj_id over a date window.
   * Returns items: { proj_id, fund_class_name, nav_date, last_val, ... }. Never throws.
   */
  function _fetchSecNav(projId, startDate, endDate) {
    const url = SEC_NAV_URL +
      '?proj_id=' + encodeURIComponent(projId) +
      '&start_nav_date=' + startDate +
      '&end_nav_date=' + endDate;
    return _secApiItems(url, 'nav ' + projId).filter(x => x && x.last_val != null);
  }

  /** yyyy-MM-dd in Bangkok, offset days back from today (0 = today). */
  function _bkkDate(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - (daysBack || 0));
    return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
  }

  /**
   * Look up the available fund classes + latest NAV for a proj_id.
   * Used by the "Find classes" UI so the user can pick the exact class they hold.
   * Returns [{ fund_class_name, last_val, nav_date }] (one per class, latest date). Never throws.
   */
  function lookupMFClasses(projId) {
    if (!projId) return [];
    const items = _fetchSecNav(projId, _bkkDate(10), _bkkDate(0));
    const byClass = {};
    items.forEach(it => {
      const name = it.fund_class_name || '';
      if (!byClass[name] || (it.nav_date || '') > (byClass[name].nav_date || '')) {
        byClass[name] = { fund_class_name: name, last_val: it.last_val, nav_date: it.nav_date };
      }
    });
    return Object.keys(byClass).map(k => byClass[k]);
  }

  /**
   * Fetch the full SEC AMC list and cache it for 10 minutes (CacheService).
   * Returns [{unique_id, comp_name_en, comp_name_th, ...}]. Never throws.
   */
  function _getAMCList() {
    const CACHE_KEY = 'sec_amc_list_v1';
    const sc = CacheService.getScriptCache();
    try {
      const hit = sc.get(CACHE_KEY);
      if (hit) return JSON.parse(hit);
    } catch (_) {}
    const items = _secApiItems('https://api.sec.or.th/v2/fund/general-info/amcs', 'amcs');
    if (items.length > 0) {
      try { sc.put(CACHE_KEY, JSON.stringify(items), 600); } catch (_) {}
    }
    return items;
  }

  // Maps partial comp_name_en (lowercase) → fund_class_name prefix used in SEC data.
  // The profiles endpoint only accepts fund_class_name= as a valid filter (unique_id=,
  // proj_name_en= both return HTTP 400). For AMCs whose fund class names don't include
  // the AMC name (e.g. Eastspring → "ES-CASH"), we search by prefix then post-filter
  // results by comp_name_en to discard other AMCs that share the substring.
  //
  // Validated 2026-06-23 via testFindAMCPrefixes():
  //   KF    → first result = KRUNGSRI ✓
  //   K-    → first result = KASIKORN ✓
  //   TISCO → first result = TISCO ✓
  //   ONE-  → first result = ONE ASSET ✓  (ONE without dash → SCB first — don't use)
  //   UOB   → first result = UOB ✓
  //   PRINCIPAL → first result = PRINCIPAL ✓
  //   KT    → first result = KRUNG THAI ✓
  //   ES    → mixed results (Kasikorn K-ESGSI, Krung Thai etc.) — post-filter essential
  //
  // Not yet found: Bangkok Capital (BCAP=0, BC=SCB), BBLAM (0), MFC (0), TMB (0).
  // Run testFindAMCPrefixes() + testEastspringViaES() to validate or extend this map.
  const AMC_PREFIX_MAP = [
    { pattern: 'eastspring', prefix: 'ES'        }, // ES-CASH, ES-DPLUS…; post-filter removes other AMC hits
    { pattern: 'krungsri',   prefix: 'KF'        }, // KFNDQ, KFLTF…
    { pattern: 'kasikorn',   prefix: 'K-'        }, // K-CASH, K-FIXED…
    { pattern: 'tisco',      prefix: 'TISCO'     }, // TISCOINA, TISCOLTF…
    { pattern: 'one asset',  prefix: 'ONE-'      }, // ONE-POWER, ONE-ULT… (ONE without dash → SCB)
    { pattern: 'uob',        prefix: 'UOB'       }, // UOBSD, UOBSMART…
    { pattern: 'principal',  prefix: 'PRINCIPAL' }, // PRINCIPAL SET50…
    { pattern: 'krung thai', prefix: 'KT'        }, // KT-EPIC, KT-PREMISE…
    { pattern: 'phatra',     prefix: 'PHATRA'    }, // legacy (merged → KKP)
  ];

  /** De-dup + map raw profile items → [{proj_id, fund_class_name, proj_name_en, amc_name}] */
  function _mapProfiles(items, limit) {
    const seen = {}, out = [];
    items.forEach(function(it) {
      const projId = it.proj_id;
      if (!projId) return;
      const cls = it.fund_class_name || it.proj_abbr_name || it.proj_name_en || '';
      const k = projId + '|' + cls;
      if (seen[k]) return;
      seen[k] = true;
      out.push({
        proj_id:         projId,
        fund_class_name: cls,
        proj_name_en:    it.proj_name_en || it.proj_name_th || '',
        amc_name:        it.comp_name_en || it.comp_name_th || ''
      });
    });
    return out.slice(0, limit || 30);
  }

  /**
   * Search SEC fund profiles — two-step strategy so searches work across ALL AMCs:
   *
   * Step 1 (fast): fund_class_name= search. Works when the query appears in the fund
   *   class abbreviation (e.g. "KKP CorePath" → 12 hits, "SCB" → 945 hits).
   *
   * Step 2 (AMC-prefix fallback): triggered when Step 1 returns 0. The SEC profiles
   *   endpoint only accepts fund_class_name= as a valid filter (unique_id= and
   *   proj_name_en= both return HTTP 400). So for AMCs whose class names don't include
   *   the AMC name (Eastspring → "ES-CASH", Krungsri → "KF-HTECH"), we look up the
   *   AMC in the list to confirm it exists, then search by its known class prefix from
   *   AMC_PREFIX_MAP. This makes searches for any known AMC name work generically.
   *
   * Returns [{ proj_id, fund_class_name, proj_name_en, amc_name }]. Never throws.
   */
  function lookupMFFunds(query) {
    if (!query) return [];

    // Step 1 — fund_class_name direct search (fast path)
    const step1Items = _secApiItems(
      SEC_PROFILES_URL + '?fund_class_name=' + encodeURIComponent(query),
      'profiles/class "' + query + '"'
    );
    if (step1Items.length > 0) {
      const out = _mapProfiles(step1Items, 30);
      Logger.log('[SEC] lookupMFFunds "' + query + '" → ' + out.length + ' via fund_class_name');
      return out;
    }

    // Step 2 — AMC-prefix fallback with AMC-name post-filter
    // Two strategies to identify which AMC the query refers to:
    //   A. Query matches an AMC name:      "Eastspring" → AMC list lookup
    //   B. Query starts with a known prefix: "ES-FIXEDRMF" → starts with "ES" → Eastspring
    // Strategy B catches the case where the user typed a partial fund class name but SEC
    // spells it differently (e.g. user types "ES-FIXEDRMF", SEC has "ES-FIXED-RMF-A").
    Logger.log('[SEC] fund_class_name="' + query + '" → 0; trying AMC-prefix fallback');
    const q = query.trim().toLowerCase();
    let mapEntry = null;

    // Strategy A — query is (part of) an AMC name
    const amcByName = _getAMCList().find(function(amc) {
      return (amc.comp_name_en || '').toLowerCase().includes(q) ||
             (amc.comp_name_th || '').toLowerCase().includes(q);
    });
    if (amcByName) {
      mapEntry = AMC_PREFIX_MAP.find(function(e) {
        return (amcByName.comp_name_en || '').toLowerCase().includes(e.pattern);
      });
      if (mapEntry) Logger.log('[SEC] fallback strategy A: AMC name → ' + amcByName.comp_name_en);
    }

    // Strategy B — query starts with a known fund class prefix (e.g. "ES-FIXEDRMF" → "ES")
    if (!mapEntry) {
      mapEntry = AMC_PREFIX_MAP.find(function(e) {
        const pfx = e.prefix.toLowerCase();
        return q === pfx || q.startsWith(pfx + '-') || q.startsWith(pfx + '_');
      });
      if (mapEntry) Logger.log('[SEC] fallback strategy B: prefix-of-query → prefix="' + mapEntry.prefix + '"');
    }

    if (!mapEntry) {
      Logger.log('[SEC] fallback: "' + query + '" matches no AMC name or known prefix — no results');
      return [];
    }

    // Fetch all items for the prefix. Post-filter by mapEntry.pattern (the AMC name fragment)
    // to discard other AMCs that share the prefix substring (e.g. "ES" also matches K-ESGSI).
    const allItems = _secApiItems(
      SEC_PROFILES_URL + '?fund_class_name=' + encodeURIComponent(mapEntry.prefix),
      'profiles/prefix "' + mapEntry.prefix + '"'
    );
    const amcItems = allItems.filter(function(it) {
      return (it.comp_name_en || it.comp_name_th || '').toLowerCase().includes(mapEntry.pattern);
    });
    Logger.log('[SEC] fallback: ' + allItems.length + ' raw → ' + amcItems.length +
      ' after filter (pattern="' + mapEntry.pattern + '")');

    const out = _mapProfiles(amcItems, 30);
    Logger.log('[SEC] lookupMFFunds "' + query + '" → ' + out.length +
      ' via prefix "' + mapEntry.prefix + '" + AMC-name filter');
    return out;
  }

  /**
   * Daily refresh: for every holding with a sec_proj_id, fetch the latest NAV and
   * update current_nav_thb + nav_updated_at. Errors per-holding are logged & skipped;
   * a holding's existing (manual) NAV is left untouched on any failure/no-match.
   * Returns { checked, updated, skipped }.
   */
  function refreshMFNav() {
    let holdings = [];
    try {
      holdings = supabaseRequest('GET',
        'mutual_fund_holdings?sec_proj_id=not.is.null' +
        '&select=id,fund_name,sec_proj_id,sec_fund_class_name') || [];
    } catch (e) {
      Logger.log('[MF NAV] could not load holdings: ' + e.message);
      return { checked: 0, updated: 0, skipped: 0 };
    }

    Logger.log('[MF NAV] refresh start — ' + holdings.length + ' holding(s) with proj_id');
    let updated = 0, skipped = 0;
    // 14-day window: covers weekends, Thai holidays, and funds with longer SEC publishing lag.
    const start = _bkkDate(14), end = _bkkDate(0);

    holdings.forEach(h => {
      try {
        const items = _fetchSecNav(h.sec_proj_id, start, end);
        if (!items.length) { Logger.log('[MF NAV] ' + h.fund_name + ': no rows'); skipped++; return; }

        // Match the exact class the user holds. If none stored and only one class exists, use it.
        let candidates = items;
        if (h.sec_fund_class_name) {
          candidates = items.filter(it => (it.fund_class_name || '') === h.sec_fund_class_name);
        } else {
          const classes = {}; items.forEach(it => classes[it.fund_class_name || ''] = true);
          if (Object.keys(classes).length > 1) {
            Logger.log('[MF NAV] ' + h.fund_name + ': multiple classes, no class stored — skipping (ambiguous)');
            skipped++; return;
          }
        }
        if (!candidates.length) {
          Logger.log('[MF NAV] ' + h.fund_name + ': class "' + h.sec_fund_class_name + '" not in response — skipping');
          skipped++; return;
        }

        // Pick the most recent nav_date among matches.
        candidates.sort((a, b) => (b.nav_date || '').localeCompare(a.nav_date || ''));
        const nav = Number(candidates[0].last_val);
        if (!(nav > 0)) { Logger.log('[MF NAV] ' + h.fund_name + ': invalid last_val — skipping'); skipped++; return; }

        supabaseRequest('PATCH', 'mutual_fund_holdings?id=eq.' + h.id, {
          current_nav_thb: nav,
          nav_date:        candidates[0].nav_date || null,  // SEC valuation date
          nav_updated_at:  new Date().toISOString()         // when we last fetched
        });
        Logger.log('[MF NAV] ' + h.fund_name + ' → ' + nav + ' THB (' + candidates[0].nav_date + ')');
        updated++;
      } catch (e) {
        // Never throw — a bad row must not abort the rest or touch the manual value.
        Logger.log('[MF NAV] ' + (h.fund_name || h.id) + ' error: ' + e.message);
        skipped++;
      }
    });

    Logger.log('[MF NAV] refresh done — updated ' + updated + ', skipped ' + skipped);
    return { checked: holdings.length, updated: updated, skipped: skipped };
  }

  return {
    fetchAll, checkRealtimeAlerts, savePrice, updateDynamicSRLevels,
    fetchGoldPrice, scrapeBondInfo, refreshMFNav, lookupMFClasses, lookupMFFunds
  };
})();

// ── Standalone test runners only defined here (all others live in Code.gs) ────

function testFetchRate()  { Logger.log('[testFetchRate] starting'); DataAgent.fetchAll(); }
function testGoldPrice()  {
  const result = DataAgent.fetchGoldPrice();
  Logger.log('[testGoldPrice] result: ' + JSON.stringify(result));
}
function testBondScrape() {
  const result = DataAgent.scrapeBondInfo('SCB276A');
  Logger.log('[testBondScrape] result: ' + JSON.stringify(result));
}

/**
 * testSingleFundNAV — confirmed SEC Open Data v2 NAV call (KKP CorePath Balanced).
 *
 * GET https://api.sec.or.th/v2/fund/daily-info/nav
 *     ?proj_id=M0209_2554&start_nav_date=…&end_nav_date=…
 * Header: Ocp-Apim-Subscription-Key. Logs status + body + parsed per-class NAV
 * (last_val). Note: one proj_id returns several fund_class_name variants — the
 * refresh job matches the exact class the user holds.
 *
 * Run from the GAS IDE → select testSingleFundNAV → Run → View → Logs.
 */
function testSingleFundNAV() {
  const PROJ_ID = 'M0209_2554';            // KKP CorePath Balanced
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testSingleFundNAV] proj_id=' + PROJ_ID +
    '  SEC_API_KEY: ' + (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING — set it in Script Properties'));
  if (!KEY) return;

  // Last 10 days so we always capture a published NAV (weekends/holidays have none).
  const end   = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const d0    = new Date(); d0.setDate(d0.getDate() - 10);
  const start = Utilities.formatDate(d0, 'Asia/Bangkok', 'yyyy-MM-dd');
  const url = 'https://api.sec.or.th/v2/fund/daily-info/nav' +
    '?proj_id=' + encodeURIComponent(PROJ_ID) +
    '&start_nav_date=' + start + '&end_nav_date=' + end;

  try {
    const r = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    const body = r.getContentText() || '';
    Logger.log('GET ' + url);
    Logger.log('HTTP ' + code);
    Logger.log('BODY: ' + (body.length > 2000 ? body.substring(0, 2000) + ' …[truncated]' : body));

    if (code === 200) {
      const j = JSON.parse(body);
      const items = Array.isArray(j) ? j
                  : Array.isArray(j.items) ? j.items
                  : Array.isArray(j.data)  ? j.data
                  : [j];
      items.forEach(it => Logger.log('   → class="' + it.fund_class_name + '"  nav_date=' +
        it.nav_date + '  last_val=' + it.last_val));
    }
  } catch (e) {
    Logger.log('[testSingleFundNAV] EXCEPTION: ' + e.message);
  }
}

/**
 * testSearchEastspring2 — second-pass probes now that we know Eastspring's unique_id.
 *
 * Probes:
 *   1. profiles?unique_id=C0000033452        — AMC-scoped fund list (does the API support it?)
 *   2. profiles?fund_class_name=ES-          — common Eastspring Thailand class prefix
 *   3. profiles?proj_name_en=Eastspring      — search on project name instead of class name
 *
 * Paste the full log (HTTP codes + item counts + first item keys) before we code the fix.
 */
function testSearchEastspring2() {
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testSearchEastspring2] SEC_API_KEY: ' + (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING'));
  if (!KEY) return;

  const headers = { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' };
  const BASE = 'https://api.sec.or.th/v2/fund/general-info/';

  function rawGet(label, url) {
    Logger.log('── ' + label + ' ──────────────────────────────');
    Logger.log('GET ' + url);
    try {
      const r = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
      const code = r.getResponseCode();
      const body = r.getContentText() || '';
      Logger.log('HTTP ' + code);
      Logger.log('BODY: ' + (body.length > 1500 ? body.substring(0, 1500) + ' …[truncated]' : body));
      if (code === 200) {
        try {
          const j = JSON.parse(body);
          const items = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : [];
          Logger.log('item count: ' + items.length);
          if (items.length > 0) {
            Logger.log('first item keys: ' + Object.keys(items[0]).join(', '));
            Logger.log('first item: ' + JSON.stringify(items[0]));
          }
        } catch (pe) { Logger.log('(parse error: ' + pe.message + ')'); }
      }
    } catch (e) {
      Logger.log('EXCEPTION: ' + e.message);
    }
  }

  rawGet('1. profiles?unique_id=C0000033452 (Eastspring AMC id)',
    BASE + 'profiles?unique_id=' + encodeURIComponent('C0000033452'));

  rawGet('2. profiles?fund_class_name=ES- (common Eastspring prefix)',
    BASE + 'profiles?fund_class_name=' + encodeURIComponent('ES-'));

  rawGet('3. profiles?proj_name_en=Eastspring',
    BASE + 'profiles?proj_name_en=' + encodeURIComponent('Eastspring'));
}

/**
 * testRefreshMFNav — run the daily NAV refresh manually so you can see its log output.
 * Select this function in the IDE dropdown → Run → View → Logs.
 */
function testRefreshMFNav() {
  const result = DataAgent.refreshMFNav();
  Logger.log('[testRefreshMFNav] result: ' + JSON.stringify(result));
}

/**
 * testSearchMFFunds — validate the SEC fund-name search (general-info/profiles).
 * Logs the raw response body (to confirm field names) + the mapped results.
 * Run from the GAS IDE → select testSearchMFFunds → Run → View → Logs.
 */
function testSearchMFFunds() {
  const QUERY = 'KKP CorePath';
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testSearchMFFunds] query="' + QUERY + '"  SEC_API_KEY: ' +
    (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING'));
  if (!KEY) return;

  const url = 'https://api.sec.or.th/v2/fund/general-info/profiles?fund_class_name=' + encodeURIComponent(QUERY);
  try {
    const r = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    Logger.log('GET ' + url);
    Logger.log('HTTP ' + r.getResponseCode());
    const body = r.getContentText() || '';
    Logger.log('RAW BODY: ' + (body.length > 2500 ? body.substring(0, 2500) + ' …[truncated]' : body));
  } catch (e) {
    Logger.log('[testSearchMFFunds] raw fetch EXCEPTION: ' + e.message);
  }

  Logger.log('MAPPED: ' + JSON.stringify(DataAgent.lookupMFFunds(QUERY), null, 2));
}

/**
 * testFindAMCPrefixes — discovers the correct fund_class_name prefix for each Thai AMC.
 *
 * The SEC profiles endpoint ONLY accepts fund_class_name= as a filter (unique_id= and
 * proj_name_en= both return HTTP 400). This test probes candidate prefixes for every
 * AMC in AMC_PREFIX_MAP and a few extras so we can validate and extend the map.
 *
 * How to read the output:
 *   "prefix=KF → 47 items | first=KF-HTECH | amc=KRUNGSRI ASSET MANAGEMENT…"
 *   → prefix "KF" is correct for Krungsri. Copy confirmed prefixes into AMC_PREFIX_MAP.
 *
 *   "prefix=ES → 0 (HTTP 204)" then "prefix=ES- → 15 items | first=ES-CASH…"
 *   → "ES-" is correct, not "ES". Update the map entry.
 *
 * Run: GAS IDE → select testFindAMCPrefixes → Run → View → Logs.
 */
function testFindAMCPrefixes() {
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testFindAMCPrefixes] SEC_API_KEY: ' + (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING'));
  if (!KEY) return;
  const headers = { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' };

  // [AMC display name, ...candidate prefixes to probe]
  const probes = [
    ['Eastspring',      'ES', 'ES-', 'EAST'],
    ['Krungsri',        'KF', 'KG', 'BAY', 'KRUNG'],
    ['Bangkok Capital', 'BCAP', 'BC', 'BGC'],
    ['Kasikorn',        'K-', 'KA-', 'KFUND'],
    ['TMB/TMBAM',       'TMB', 'TMBAM', 'TMBCOF'],
    ['TISCO',           'TISCO', 'TISC'],
    ['One Asset',       'ONE', 'ONE-', 'ONEAM'],
    ['UOB',             'UOB', 'UOBSM', 'UOBSMART'],
    ['PRINCIPAL',       'PRINCIPAL', 'PRIN'],
    ['Krung Thai/KTAM', 'KT', 'KTAM', 'KTA'],
    ['BBLAM',           'BBLAM', 'BBL'],
    ['MFC',             'MFC', 'MFC-'],
  ];

  probes.forEach(function(probe) {
    const name = probe[0];
    const prefixes = probe.slice(1);
    Logger.log('\n── ' + name + ' ──');
    prefixes.forEach(function(pfx) {
      try {
        const url = 'https://api.sec.or.th/v2/fund/general-info/profiles?fund_class_name=' +
                    encodeURIComponent(pfx);
        const r = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
        const code = r.getResponseCode();
        if (code === 204) {
          Logger.log('  "' + pfx + '" → 0 (HTTP 204 — no match)');
          return;
        }
        const body = r.getContentText() || '';
        if (code !== 200) {
          Logger.log('  "' + pfx + '" → HTTP ' + code + ': ' + body.substring(0, 80));
          return;
        }
        const j = JSON.parse(body);
        const items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
        const first = items[0];
        Logger.log('  "' + pfx + '" → ' + items.length + ' item(s)' +
          (first ? ' | first_class=' + first.fund_class_name + ' | amc=' + (first.comp_name_en || '').substring(0, 30) : ''));
      } catch (e) {
        Logger.log('  "' + pfx + '" EXCEPTION: ' + e.message);
      }
    });
  });
}

/**
 * testEastspringViaES — confirms whether Eastspring funds appear in fund_class_name=ES results.
 *
 * The SEC API does a case-insensitive substring match on fund_class_name. "ES" matches
 * K-ESGSI (Kasikorn), KT-Ashares ("ares" contains "es"), and — if Eastspring names
 * their classes "ES-CASH", "ES-DPLUS" etc. — Eastspring funds too.
 *
 * This test fetches ALL pages of fund_class_name=ES, counts Eastspring funds,
 * and shows the breakdown by AMC so we can decide whether the prefix + post-filter
 * approach works or if we need a different prefix.
 *
 * Expected outcomes:
 *   Eastspring count > 0 → AMC_PREFIX_MAP entry 'ES' is correct; two-step search works.
 *   Eastspring count = 0 → Eastspring's fund classes don't contain "ES"; need a new prefix.
 *
 * Run: GAS IDE → select testEastspringViaES → Run → View → Logs.
 */
function testEastspringViaES() {
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testEastspringViaES] SEC_API_KEY: ' + (KEY ? 'set' : 'MISSING'));
  if (!KEY) return;

  const headers = { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' };
  const all = [];
  let nextUrl = 'https://api.sec.or.th/v2/fund/general-info/profiles?fund_class_name=ES';
  let page = 0;
  while (nextUrl && page < 10) {
    page++;
    const r = UrlFetchApp.fetch(nextUrl, { method: 'get', headers: headers, muteHttpExceptions: true });
    const code = r.getResponseCode();
    const body = r.getContentText() || '';
    if (code !== 200 && code !== 204) {
      Logger.log('p' + page + ' HTTP ' + code + ': ' + body.substring(0, 200));
      break;
    }
    if (code === 204) break;
    const j = JSON.parse(body);
    const items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    all.push.apply(all, items);
    Logger.log('p' + page + ': ' + items.length + ' items (total so far: ' + all.length + ')');
    const cursor = j.next_cursor;
    nextUrl = cursor
      ? 'https://api.sec.or.th/v2/fund/general-info/profiles?fund_class_name=ES&next_cursor=' +
        encodeURIComponent(cursor)
      : null;
  }

  Logger.log('Total fund_class_name=ES results: ' + all.length + ' across ' + page + ' page(s)');

  // Filter for Eastspring specifically
  const es = all.filter(function(it) {
    return (it.comp_name_en || '').toLowerCase().includes('eastspring');
  });
  Logger.log('Eastspring funds in results: ' + es.length);
  es.slice(0, 10).forEach(function(it) {
    Logger.log('  → fund_class_name=' + it.fund_class_name + ' | proj_name_en=' + it.proj_name_en);
  });

  // AMC breakdown (how many items from each AMC)
  const amcCounts = {};
  all.forEach(function(it) {
    const n = (it.comp_name_en || 'unknown').substring(0, 35);
    amcCounts[n] = (amcCounts[n] || 0) + 1;
  });
  Logger.log('AMC breakdown: ' + JSON.stringify(amcCounts));
}

/**
 * testMFSearchMultiAMC — validates the two-step search strategy across multiple AMC families.
 *
 * For each query it logs:
 *   - lookupMFFunds() result count + first result (tests the full two-step path)
 *   - Raw probe of profiles?proj_name_en= (extra data point)
 *   - AMC list sample: unique_id + both name fields for matched AMCs
 *
 * Expected results:
 *   "KKP CorePath"    → results via Step 1 (fund_class_name)
 *   "Eastspring"      → 0 via Step 1 → results via Step 2 (AMC fallback)
 *   "Krungsri"        → Step 1 or Step 2 depending on class naming convention
 *   "SCB"             → Step 1 or Step 2
 *   "Bangkok Capital" → Step 1 or Step 2
 *
 * Run from GAS IDE → select testMFSearchMultiAMC → Run → View → Logs.
 */
function testMFSearchMultiAMC() {
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testMFSearchMultiAMC] SEC_API_KEY: ' + (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING'));
  if (!KEY) return;

  const queries = ['KKP CorePath', 'Eastspring', 'Krungsri', 'SCB', 'Bangkok Capital'];
  const headers = { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' };

  queries.forEach(function(q) {
    Logger.log('\n══════ Query: "' + q + '" ══════');

    // Full two-step path (this is what the UI calls)
    const results = DataAgent.lookupMFFunds(q);
    Logger.log('  lookupMFFunds → ' + results.length + ' result(s)');
    if (results.length > 0) Logger.log('  first: ' + JSON.stringify(results[0]));

    // Bonus probe: proj_name_en (not currently in the lookup, but useful to know)
    try {
      const url = 'https://api.sec.or.th/v2/fund/general-info/profiles?proj_name_en=' +
                  encodeURIComponent(q);
      const r = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
      const code = r.getResponseCode();
      const body = r.getContentText() || '';
      if (code === 200) {
        const j = JSON.parse(body);
        const items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
        Logger.log('  proj_name_en probe → HTTP ' + code + ', ' + items.length + ' item(s)');
        if (items.length > 0) Logger.log('  proj_name_en first: ' + JSON.stringify(items[0]));
      } else {
        Logger.log('  proj_name_en probe → HTTP ' + code + ': ' + body.substring(0, 200));
      }
    } catch (e) {
      Logger.log('  proj_name_en probe EXCEPTION: ' + e.message);
    }
  });

  // Log the AMC list structure + matches for our test queries
  Logger.log('\n══════ AMC list structure + matches ══════');
  try {
    const url = 'https://api.sec.or.th/v2/fund/general-info/amcs';
    const r = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
    const code = r.getResponseCode();
    const body = r.getContentText() || '';
    Logger.log('AMC list HTTP ' + code);
    if (code === 200) {
      const j = JSON.parse(body);
      const items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
      Logger.log('Total AMCs: ' + items.length);
      if (items.length > 0) Logger.log('Field names: ' + Object.keys(items[0]).join(', '));
      ['eastspring', 'krungsri', 'scb', 'bangkok capital', 'kkp'].forEach(function(name) {
        const match = items.find(function(a) {
          return (a.comp_name_en || '').toLowerCase().includes(name) ||
                 (a.comp_name_th || '').toLowerCase().includes(name);
        });
        Logger.log('  "' + name + '" → ' + (match ? JSON.stringify(match) : 'no match'));
      });
    }
  } catch (e) {
    Logger.log('AMC list EXCEPTION: ' + e.message);
  }
}

/**
 * testSearchEastspring — diagnose why Eastspring funds don't appear in lookupMFFunds().
 *
 * Runs four probes in sequence:
 *   1. fund_class_name=Eastspring        (English, mixed case)
 *   2. fund_class_name=EASTSPRING        (uppercase — in case SEC normalises differently)
 *   3. fund_class_name=อีสท์สปริง        (Thai name)
 *   4. general-info/amcs                 (full AMC list — find Eastspring's comp_id / unique_id)
 *
 * For each probe logs: HTTP code + first 1 500 chars of raw body + item count.
 * Paste the full log output back into the chat for analysis before any code changes.
 */
function testSearchEastspring() {
  const KEY = Config.SEC_API_KEY();
  Logger.log('[testSearchEastspring] SEC_API_KEY: ' + (KEY ? 'set (' + KEY.length + ' chars)' : 'MISSING'));
  if (!KEY) return;

  const headers = { 'Ocp-Apim-Subscription-Key': KEY, 'Accept': 'application/json' };

  function rawGet(label, url) {
    Logger.log('── ' + label + ' ──────────────────────────────');
    Logger.log('GET ' + url);
    try {
      const r = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
      const code = r.getResponseCode();
      const body = r.getContentText() || '';
      Logger.log('HTTP ' + code);
      Logger.log('BODY: ' + (body.length > 1500 ? body.substring(0, 1500) + ' …[truncated]' : body));
      if (code === 200) {
        try {
          const j = JSON.parse(body);
          const items = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : [];
          Logger.log('item count: ' + items.length);
          // Log first result's field names so we know what's searchable
          if (items.length > 0) Logger.log('first item keys: ' + Object.keys(items[0]).join(', '));
        } catch (pe) { Logger.log('(parse error: ' + pe.message + ')'); }
      }
    } catch (e) {
      Logger.log('EXCEPTION: ' + e.message);
    }
  }

  const BASE = 'https://api.sec.or.th/v2/fund/general-info/';

  // Probe 1–3: fund_class_name substring searches
  rawGet('1. fund_class_name=Eastspring',
    BASE + 'profiles?fund_class_name=' + encodeURIComponent('Eastspring'));

  rawGet('2. fund_class_name=EASTSPRING',
    BASE + 'profiles?fund_class_name=' + encodeURIComponent('EASTSPRING'));

  rawGet('3. fund_class_name=อีสท์สปริง',
    BASE + 'profiles?fund_class_name=' + encodeURIComponent('อีสท์สปริง'));

  // Probe 4: full AMC list — reveals Eastspring's real identifier and any search params
  rawGet('4. general-info/amcs (full AMC list)',
    BASE + 'amcs');
}
