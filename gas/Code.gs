/**
 * Code.gs — Orchestrator
 *
 * TRIGGER SETUP (one-time, run setupTriggers() from the GAS IDE):
 *   - (removed) 7AM Tech-News brief — now on demand from the app (web action generateNewsBrief)
 *   - Daily 8AM Bangkok   → onDailyTrigger (morning fetch; US prices = prev-day close)
 *   - Daily 4AM Bangkok   → onDailyTrigger (= ~5PM ET; captures today's US closing prices)
 *   - Every Monday 8AM    → onWeeklyTrigger  (also fires from daily on Mondays)
 *   - 1st of month        → onMonthlyTrigger (checked inside daily trigger)
 *   - Every 5 minutes     → onRealtimeTrigger
 *
 * WEB APP (Deploy → New deployment → Web app → Execute as Me → Anyone):
 *   GET ?action=fetchData       → DataAgent.fetchAll()
 *   GET ?action=analyzeGrowth   → AnalystAgent.reviewGrowthPortfolios()
 *   GET ?action=analyzeWeekly   → AnalystAgent.reviewDividendAndETF()
 *   GET ?action=generateDCA     → DCAAgent.generatePlans()
 *   GET ?action=fetchNews       → NewsAgent.fetchForAllHoldings()
 *   GET ?action=checkAlerts     → DataAgent.checkRealtimeAlerts() (returns JSON)
 */

// ── Web App entry point ───────────────────────────────────────────────────────

function doGet(e) {
  const action = e?.parameter?.action || '';
  let result = { ok: true, action: action };

  try {
    if (action === 'fetchData') {
      DataAgent.fetchAll();
    } else if (action === 'analyzeGrowth') {
      AnalystAgent.reviewGrowthPortfolios();
    } else if (action === 'analyzeWeekly') {
      AnalystAgent.reviewDividendAndETF();
    } else if (action === 'generateDCA') {
      DCAAgent.generatePlans();
    } else if (action === 'fetchNews') {
      NewsAgent.fetchForAllHoldings();
    } else if (action === 'checkAlerts') {
      result.alerts = DataAgent.checkRealtimeAlerts();
    } else if (action === 'getPrice') {
      const symbol = e?.parameter?.symbol || '';
      if (!symbol) throw new Error('symbol required');
      const data = _yahooQuoteMeta(symbol);
      if (!data) throw new Error('Ticker not found: ' + symbol);
      result.symbol = symbol.toUpperCase();
      result.price = data.regularMarketPrice;
      result.name = data.shortName || data.longName || symbol;
      result.currency = data.currency || 'USD';
    } else if (action === 'getPrices') {
      // Batch quote: one request for many tickers. Fetches each server-side
      // (works on mobile where client-side proxies get blocked) and persists
      // to market_data so the frontend doesn't need a separate savePrice call.
      const raw = e?.parameter?.tickers || '';
      const symbols = raw.split(',').map(function(s){ return s.trim().toUpperCase(); }).filter(String);
      if (!symbols.length) throw new Error('tickers required');
      const prices = {};
      symbols.forEach(function(sym) {
        try {
          const meta = _yahooQuoteMeta(sym);
          const p = meta && meta.regularMarketPrice;
          if (p > 0) {
            prices[sym] = p;
            DataAgent.savePrice(sym, p, 'stock', meta.currency || 'USD');
          }
        } catch (e2) { /* skip one bad ticker, keep the rest */ }
      });
      result.prices = prices;
    } else if (action === 'savePrice') {
      const symbol = (e?.parameter?.symbol || '').toUpperCase();
      const price  = parseFloat(e?.parameter?.price || '0');
      const asset_type = e?.parameter?.asset_type || 'stock';
      const currency   = e?.parameter?.currency   || 'USD';
      if (!symbol || !(price > 0)) throw new Error('symbol and price > 0 required');
      DataAgent.savePrice(symbol, price, asset_type, currency);
      result.saved = true;
    } else if (action === 'getHistory') {
      const symbol = (e?.parameter?.symbol || '').toUpperCase().trim();
      if (!symbol) throw new Error('symbol required');
      const hist = _yahooHistory(symbol);
      if (!hist) throw new Error('History not found: ' + symbol);
      result.history = hist;
    } else if (action === 'getOverview') {
      const symbol = (e?.parameter?.symbol || '').toUpperCase().trim();
      if (!symbol) throw new Error('symbol required');
      result.overview = _yahooOverview(symbol);   // null-safe; fields degrade to null
    } else if (action === 'getEarnings') {
      const symbol = (e?.parameter?.symbol || '').toUpperCase().trim();
      if (!symbol) throw new Error('symbol required');
      result.earnings = _yahooEarnings(symbol);   // Yahoo primary → Claude web-search fallback; null-safe
    } else if (action === 'searchTicker') {
      const q = e?.parameter?.q || '';
      if (!q) throw new Error('q required');
      result.quotes = _yahooSearch(q);
    } else if (action === 'analyzeAll') {
      AnalystAgent.reviewAllPortfolios();
    } else if (action === 'analyzePortfolio') {
      const portfolioId = e?.parameter?.portfolioId;
      if (!portfolioId) throw new Error('portfolioId required');
      AnalystAgent.reviewPortfolioById(portfolioId);
    } else if (action === 'generatePortfolioAnalysis') {
      // On-demand portfolio analysis for the All Portfolio / Weekly Review pages
      // (replaced the auto onDailyTrigger call, 2026-07-16). Blank portfolioId = all
      // portfolios; a set value = that one. Persists to ai_analyses/sr_levels as before.
      const portfolioId = (e?.parameter?.portfolioId || '').trim();
      const res = AnalystAgent.generatePortfolioAnalysis(portfolioId || null);
      result.generatedAt = res.generatedAt;
      result.portfolios  = res.portfolios;
    } else if (action === 'testTelegram') {
      const userId = e?.parameter?.userId;
      result.sent = _sendTestTelegram(userId);
    } else if (action === 'updateSRLevels') {
      DataAgent.updateDynamicSRLevels();
    } else if (action === 'getGoldPrice') {
      const gold = DataAgent.fetchGoldPrice();
      if (!gold) throw new Error('All gold price sources failed');
      result.price  = gold.price;
      result.source = gold.source;
    } else if (action === 'scrapeBondInfo') {
      const bondCode = (e?.parameter?.bondCode || '').toUpperCase().trim();
      if (!bondCode) throw new Error('bondCode required');
      const info = DataAgent.scrapeBondInfo(bondCode);
      if (!info) throw new Error('Bond not found or scrape failed — use manual input');
      result.bondInfo = info;
    } else if (action === 'refreshMFNav') {
      result.mf = DataAgent.refreshMFNav();
    } else if (action === 'mfLookupClasses') {
      const projId = (e?.parameter?.projId || '').trim();
      if (!projId) throw new Error('projId required');
      result.classes = DataAgent.lookupMFClasses(projId);
    } else if (action === 'mfSearchFunds') {
      const q = (e?.parameter?.q || '').trim();
      if (!q) throw new Error('q required');
      result.funds = DataAgent.lookupMFFunds(q);
    } else if (action === 'mfGuessCode') {
      const q = (e?.parameter?.q || '').trim();
      if (!q) throw new Error('q required');
      result.codes = DataAgent.searchFinnomenaFunds(q);
    } else if (action === 'getConfig') {
      const key = (e?.parameter?.key || '').trim();
      if (!key) throw new Error('key required');
      const rows = supabaseRequest('GET', 'app_config?key=eq.' + encodeURIComponent(key) + '&select=value&limit=1');
      result.value = (rows && rows.length > 0) ? rows[0].value : null;
    } else if (action === 'saveConfig') {
      const key   = (e?.parameter?.key   || '').trim();
      const value = (e?.parameter?.value || '').trim();
      if (!key) throw new Error('key required');
      supabaseUpsert('app_config?on_conflict=key', { key: key, value: value, updated_at: new Date().toISOString() });
      result.saved = true;
    } else if (action === 'sendNewsBrief') {
      NotificationAgent.sendDailyNewsBrief();
      result.sent = true;
    } else if (action === 'generateNewsBrief') {
      // On-demand brief for the Analysis › News page (no Telegram — the daily push was removed).
      const userId = (e?.parameter?.userId || '').trim();
      if (!userId) throw new Error('userId required');
      result.brief = NotificationAgent.generateNewsBriefForUser(userId);
    } else if (action === 'dcaExportSheet') {
      const userId      = (e?.parameter?.userId      || '').trim();
      const month       = (e?.parameter?.month       || '').trim();   // 'YYYY-MM'
      const portfolioId = (e?.parameter?.portfolioId || '').trim();   // one tab, or all if blank
      result.export = DCAAgent.exportDCAToSheet(userId, month, portfolioId || null);
    } else if (action === 'benchmarkHistory') {
      // symbols: comma-separated (e.g. "^GSPC,^IXIC,NVDA,AAPL"); range (e.g. 6mo/1y/ytd/5d); interval (1d/1h/1m)
      const symbols  = (e?.parameter?.symbols  || '').split(',').map(function(s){ return s.trim(); }).filter(String);
      const range    = (e?.parameter?.range    || '6mo').trim();
      const interval = (e?.parameter?.interval || '1d').trim();
      if (!symbols.length) throw new Error('symbols required');
      const series = {};
      symbols.forEach(function(sym) {
        const s = _yahooChart(sym, range, interval);   // {t:[],c:[]} or null
        if (s) series[sym] = s;
      });
      result.series = series;
    } else if (action === 'ping') {
      result.message = 'MyAsset+ GAS is alive';
    } else {
      result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function _sendTestTelegram(userId) {
  const token = Config.TELEGRAM_BOT_TOKEN();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set in Script Properties');

  // Fetch ALL users so we can notify both
  const allUsers = supabaseRequest('GET', 'users?select=id,name,telegram_chat_id');
  if (!allUsers || allUsers.length === 0) throw new Error('No users found');

  // Bangkok time (UTC+7)
  const bangkokDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const bangkokTime = bangkokDate.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC'
  }) + ' (Bangkok)';

  const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const sent = [];
  const failed = [];

  allUsers.forEach(function(user) {
    if (!user.telegram_chat_id) return; // skip users with no chat ID

    const msg =
      '🤖 <b>MyAsset+ — Test Alert</b>\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '✅ Telegram connected successfully!\n' +
      `👤 User: ${user.name}\n` +
      `🕐 Time: ${bangkokTime}\n` +
      '📡 Status: All systems operational\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '<i>MyAsset+ Asset Tracker</i>';

    const resp = UrlFetchApp.fetch(telegramUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: user.telegram_chat_id, text: msg, parse_mode: 'HTML' }),
      muteHttpExceptions: true
    });

    const body = JSON.parse(resp.getContentText());
    if (body.ok) {
      sent.push(user.name);
    } else {
      failed.push(user.name + ': ' + body.description);
    }
  });

  if (sent.length === 0 && failed.length > 0) {
    throw new Error(failed.join('; '));
  }
  if (failed.length > 0) {
    Logger.log('[Telegram] Partial failure: ' + failed.join('; '));
  }
  return { sent: sent, failed: failed };
}

function _yahooQuoteMeta(symbol) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) + '?interval=1d&range=1d';
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.getResponseCode() !== 200) return null;
    const data = JSON.parse(resp.getContentText());
    return data?.chart?.result?.[0]?.meta || null;
  } catch (e) {
    return null;
  }
}

/**
 * 6-month daily history + meta for the Ticker Detail modal's technicals gauge.
 * Returns { symbol, name, currency, price, prevClose, week52High, week52Low,
 *           closes:[...], marketCap, peRatio }. Closes are chronological, nulls dropped.
 * PE/marketCap come from the v7 quote endpoint and degrade to null if it's
 * unavailable (Yahoo now gates it behind a crumb from some IPs). Never throws.
 */
function _yahooHistory(symbol) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) + '?interval=1d&range=6mo';
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.getResponseCode() !== 200) return null;
    const result = JSON.parse(resp.getContentText())?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(function(c) { return c != null; });
    if (closes.length < 30) return null; // not enough data for SMA50/MACD

    const out = {
      symbol:     symbol,
      name:       meta.shortName || meta.longName || symbol,
      currency:   meta.currency || 'USD',
      price:      meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1],
      prevClose:  meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose,
      week52High: meta.fiftyTwoWeekHigh != null ? meta.fiftyTwoWeekHigh : null,
      week52Low:  meta.fiftyTwoWeekLow  != null ? meta.fiftyTwoWeekLow  : null,
      closes:     closes,
      marketCap:  null,
      peRatio:    null
    };

    // Best-effort enrichment — PE + market cap. Non-fatal.
    try {
      const qUrl = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbol);
      const qResp = UrlFetchApp.fetch(qUrl, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (qResp.getResponseCode() === 200) {
        const q = JSON.parse(qResp.getContentText())?.quoteResponse?.result?.[0];
        if (q) {
          out.marketCap = q.marketCap != null ? q.marketCap : null;
          out.peRatio   = q.trailingPE != null ? q.trailingPE : null;
          if (out.week52High == null && q.fiftyTwoWeekHigh != null) out.week52High = q.fiftyTwoWeekHigh;
          if (out.week52Low  == null && q.fiftyTwoWeekLow  != null) out.week52Low  = q.fiftyTwoWeekLow;
          if (q.longName || q.shortName) out.name = q.longName || q.shortName;
        }
      }
    } catch (e2) { /* enrichment is optional */ }

    return out;
  } catch (e) {
    Logger.log('[getHistory] failed for ' + symbol + ': ' + e.message);
    return null;
  }
}

/**
 * Lightweight timestamped OHLC-close series for the Benchmark comparison chart.
 * Returns { t:[unixSec,...], c:[close,...] } (chronological, raw — nulls kept so
 * the frontend can align by timestamp and forward-fill), or null on any failure.
 * Never throws. `range` = 1mo|3mo|6mo|1y|ytd|5d…, `interval` = 1d|1h|1m.
 */
function _yahooChart(symbol, range, interval) {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?interval=' + encodeURIComponent(interval || '1d') +
      '&range='    + encodeURIComponent(range || '6mo');
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.getResponseCode() !== 200) return null;
    const r = JSON.parse(resp.getContentText())?.chart?.result?.[0];
    if (!r || !r.timestamp) return null;
    const closes = r.indicators?.quote?.[0]?.close || [];
    return { t: r.timestamp, c: closes };
  } catch (e) {
    Logger.log('[benchmarkHistory] failed for ' + symbol + ': ' + e.message);
    return null;
  }
}

/**
 * Yahoo needs a cookie + crumb pair for the v10 quoteSummary / v7 quote endpoints.
 * Fetch fc.yahoo.com for a session cookie, then /v1/test/getcrumb. Cached ~30 min
 * in the script cache. Returns { crumb, cookie } — crumb may be '' if the challenge
 * fails (we still try the request; some IPs are ungated). Never throws.
 */
function _yahooCrumb() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('yh_crumb');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  try {
    var r1 = UrlFetchApp.fetch('https://fc.yahoo.com/', {
      muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var hdrs = r1.getAllHeaders();
    var sc = hdrs['Set-Cookie'] || hdrs['set-cookie'] || [];
    if (!Array.isArray(sc)) sc = [sc];
    var cookie = sc.map(function (c) { return String(c).split(';')[0]; }).filter(String).join('; ');
    var r2 = UrlFetchApp.fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
    });
    var crumb = (r2.getContentText() || '').trim();
    if (r2.getResponseCode() !== 200 || !crumb || crumb.length > 128 || crumb.indexOf('<') >= 0) {
      return { crumb: '', cookie: cookie };
    }
    var out = { crumb: crumb, cookie: cookie };
    cache.put('yh_crumb', JSON.stringify(out), 1800);
    return out;
  } catch (e) {
    return { crumb: '', cookie: '' };
  }
}

/** v10 quoteSummary for `modules`; returns result[0] or null. Tries both query hosts. */
function _yahooQuoteSummary(symbol, modules) {
  var c = _yahooCrumb();
  var bases = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
  for (var i = 0; i < bases.length; i++) {
    try {
      var url = bases[i] + '/v10/finance/quoteSummary/' + encodeURIComponent(symbol) +
        '?modules=' + encodeURIComponent(modules) +
        (c && c.crumb ? '&crumb=' + encodeURIComponent(c.crumb) : '');
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': c ? c.cookie : '' }
      });
      if (resp.getResponseCode() === 200) {
        var res = JSON.parse(resp.getContentText());
        var out = res && res.quoteSummary && res.quoteSummary.result && res.quoteSummary.result[0];
        if (out) return out;
      }
    } catch (e) { /* try next host */ }
  }
  return null;
}

/**
 * Overview key-stats for the Ticker Detail modal's Overview tab.
 * Pulls summaryDetail / defaultKeyStatistics / financialData / price from Yahoo.
 * Yahoo wraps numbers as { raw, fmt }; we return the raw numbers. Never throws.
 */
function _yahooOverview(symbol) {
  try {
    var r = _yahooQuoteSummary(symbol, 'summaryDetail,defaultKeyStatistics,financialData,price');
    if (!r) return null;
    var ks = r.defaultKeyStatistics || {}, fd = r.financialData || {},
        sd = r.summaryDetail || {}, pr = r.price || {};
    var raw = function (o) {
      if (o == null) return null;
      if (typeof o === 'number') return o;
      return (typeof o === 'object' && 'raw' in o) ? o.raw : null;
    };
    var pick = function () {
      for (var i = 0; i < arguments.length; i++) { var v = raw(arguments[i]); if (v != null) return v; }
      return null;
    };
    return {
      name:          pr.longName || pr.shortName || symbol,
      price:         pick(pr.regularMarketPrice),
      volume:        pick(sd.volume, pr.regularMarketVolume),
      avgVolume:     pick(sd.averageVolume, sd.averageDailyVolume3Month),
      marketCap:     pick(pr.marketCap, sd.marketCap),
      dividendYield: pick(sd.dividendYield, sd.trailingAnnualDividendYield),
      peRatio:       pick(sd.trailingPE),
      eps:           pick(ks.trailingEps),
      netIncome:     pick(ks.netIncomeToCommon),
      revenue:       pick(fd.totalRevenue),
      floatShares:   pick(ks.floatShares),
      beta:          pick(ks.beta, sd.beta)
    };
  } catch (e) {
    Logger.log('[getOverview] failed for ' + symbol + ': ' + e.message);
    return null;
  }
}

/** Standalone test — run from the GAS IDE to confirm Overview data is reachable. */
function testOverview() {
  ['O', 'AAPL'].forEach(function (sym) {
    Logger.log(sym + ' → ' + JSON.stringify(_yahooOverview(sym)));
  });
}

/**
 * Earnings for the Ticker Detail modal's Earnings tab: next earnings date +
 * last-4-quarters EPS actual/estimate and revenue actual. Yahoo v10 quoteSummary
 * (earnings + earningsHistory + calendarEvents) is primary; if Yahoo returns
 * nothing usable, falls back to Claude web search. Never throws.
 * Shape: { nextDate:<unixSec|null>, nextDateIsRange:bool, currency, quarters:[
 *   { label, endDate:<unixSec|null>, epsActual, epsEstimate, revenue, revenueEstimate } ], source }
 */
function _yahooEarnings(symbol) {
  try {
    var r = _yahooQuoteSummary(symbol, 'earnings,earningsHistory,calendarEvents');
    var raw = function (o) { if (o == null) return null; if (typeof o === 'number') return o; return ('raw' in o) ? o.raw : null; };
    var out = { nextDate: null, nextDateIsRange: false, currency: 'USD', quarters: [], source: 'yahoo' };

    if (r) {
      if (r.earnings && r.earnings.financialCurrency) out.currency = r.earnings.financialCurrency;
      var ce = r.calendarEvents && r.calendarEvents.earnings;
      if (ce && ce.earningsDate && ce.earningsDate.length) {
        out.nextDate = raw(ce.earningsDate[0]);
        out.nextDateIsRange = ce.earningsDate.length > 1;
      }
      var eh = (r.earningsHistory && r.earningsHistory.history) || [];
      var fc = (r.earnings && r.earnings.financialsChart && r.earnings.financialsChart.quarterly) || [];
      var ehS = eh.slice(-4), fcS = fc.slice(-4);
      var n = Math.max(ehS.length, fcS.length);
      for (var i = 0; i < n; i++) {
        var eItem = ehS[i], fItem = fcS[i];
        out.quarters.push({
          label:       (fItem && fItem.date) || (eItem && eItem.quarter && eItem.quarter.fmt) || '',
          endDate:     raw(eItem && eItem.quarter),
          epsActual:   raw(eItem && eItem.epsActual),
          epsEstimate: raw(eItem && eItem.epsEstimate),
          revenue:     raw(fItem && fItem.revenue),
          revenueEstimate: null           // Yahoo has no historical revenue estimate
        });
      }
    }

    if (out.quarters.length || out.nextDate != null) return out;
    var fb = _claudeEarnings(symbol);      // Yahoo empty → Claude fallback
    return fb || out;
  } catch (e) {
    Logger.log('[getEarnings] failed for ' + symbol + ': ' + e.message);
    return null;
  }
}

/**
 * Claude web-search fallback for earnings when Yahoo has nothing. Returns the same
 * shape as _yahooEarnings (dates as ISO strings the frontend parses) or null.
 * Only fires on Yahoo miss, so it rarely runs. Never throws.
 */
function _claudeEarnings(symbol) {
  try {
    var key = Config.CLAUDE_API_KEY();
    if (!key) return null;
    var sys = 'You are a financial data assistant. Use web search to find the company\'s earnings. ' +
      'Reply with ONLY a JSON object, no prose, no markdown fences.';
    var prompt = 'For stock ticker ' + symbol + ', return JSON: ' +
      '{"nextDateISO":"YYYY-MM-DD or null (next scheduled earnings date)",' +
      '"currency":"USD",' +
      '"quarters":[{"label":"e.g. 2Q 2024","epsActual":number,"epsEstimate":number,' +
      '"revenue":number (in absolute dollars),"revenueEstimate":number or null}]} ' +
      'for the LAST 4 reported quarters, oldest first. Use null for anything you cannot verify. ' +
      'Every number must come from a search result — never guess.';
    var payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: sys,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }]
    };
    var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) { Logger.log('[getEarnings] Claude ' + resp.getResponseCode()); return null; }
    var body = JSON.parse(resp.getContentText());
    var text = (body.content || []).filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('\n').trim();
    if (!text) return null;
    var data;
    try { data = JSON.parse(text); }
    catch (e1) { var m = text.match(/\{[\s\S]*\}/); if (!m) return null; data = JSON.parse(m[0]); }
    var nd = null;
    if (data.nextDateISO && /^\d{4}-\d{2}-\d{2}/.test(data.nextDateISO)) {
      nd = Math.floor(new Date(data.nextDateISO + 'T00:00:00Z').getTime() / 1000);
    }
    return {
      nextDate: nd, nextDateIsRange: false,
      currency: data.currency || 'USD',
      quarters: (data.quarters || []).slice(-4).map(function (q) {
        return {
          label: q.label || '', endDate: null,
          epsActual: q.epsActual != null ? q.epsActual : null,
          epsEstimate: q.epsEstimate != null ? q.epsEstimate : null,
          revenue: q.revenue != null ? q.revenue : null,
          revenueEstimate: q.revenueEstimate != null ? q.revenueEstimate : null
        };
      }),
      source: 'claude'
    };
  } catch (e) {
    Logger.log('[getEarnings] Claude fallback failed for ' + symbol + ': ' + e.message);
    return null;
  }
}

/** Standalone test — run from the GAS IDE to confirm Earnings data is reachable. */
function testEarnings() {
  ['O', 'AAPL'].forEach(function (sym) {
    Logger.log(sym + ' → ' + JSON.stringify(_yahooEarnings(sym)));
  });
}

function _yahooSearch(query) {
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(query) + '&newsCount=0&quotesCount=8&enableFuzzyQuery=false';
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (resp.getResponseCode() !== 200) return [];
    const data = JSON.parse(resp.getContentText());
    return (data.quotes || [])
      .filter(function(q) { return q.quoteType === 'EQUITY' || q.quoteType === 'ETF'; })
      .map(function(q) { return { symbol: q.symbol, name: q.shortname || q.longname || '' }; });
  } catch (e) {
    return [];
  }
}

// ── Entry points (called by time-based triggers) ──────────────────────────────

function onDailyTrigger() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const dayOfMonth = today.getDate();

  Logger.log('[Orchestrator] Daily trigger fired: ' + today.toISOString());

  try {
    // 1. Fetch all market data first
    DataAgent.fetchAll();

    // 2. Monthly DCA on the 1st
    if (dayOfMonth === 1) {
      onMonthlyTrigger();
    }

    // 3. Weekly review on Mondays
    if (dayOfWeek === 1) {
      onWeeklyTrigger();
    } else {
      // Daily news + notifications (skip Sat/Sun). Portfolio analysis
      // (AnalystAgent.reviewAllPortfolios) is NO LONGER auto-run here — it is
      // on-demand only via the web action `generatePortfolioAnalysis` (2026-07-16).
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        NewsAgent.fetchForAllHoldings();
        NotificationAgent.sendHighImpactNewsAlerts();
        NotificationAgent.sendDailyGrowthReview();
      }
    }
  } catch (e) {
    Logger.log('[Orchestrator] Daily trigger error: ' + e.message);
    _logError('onDailyTrigger', e);
  }
}

function onWeeklyTrigger() {
  Logger.log('[Orchestrator] Weekly trigger fired');
  try {
    DataAgent.fetchAll();
    DataAgent.updateDynamicSRLevels(); // Recalculate S/R from 90-day history + 52wk levels weekly
    // AnalystAgent.reviewAllPortfolios() removed 2026-07-16 — portfolio analysis is
    // on-demand only (web action `generatePortfolioAnalysis`), no auto schedule.
    NewsAgent.fetchForAllHoldings();
    NotificationAgent.sendHighImpactNewsAlerts();
    NotificationAgent.sendWeeklyReview();
  } catch (e) {
    Logger.log('[Orchestrator] Weekly trigger error: ' + e.message);
    _logError('onWeeklyTrigger', e);
  }
}

function onMonthlyTrigger() {
  Logger.log('[Orchestrator] Monthly DCA trigger fired');
  try {
    DCAAgent.generatePlans();
  } catch (e) {
    Logger.log('[Orchestrator] Monthly trigger error: ' + e.message);
    _logError('onMonthlyTrigger', e);
  }
}

function onRealtimeTrigger() {
  try {
    const alerts = DataAgent.checkRealtimeAlerts();
    if (alerts.length > 0) {
      NotificationAgent.sendRealtimeAlerts(alerts);
    }
  } catch (e) {
    Logger.log('[Orchestrator] Realtime trigger error: ' + e.message);
  }
}

// Daily Tech-News brief (7AM Bangkok). Standalone — separate from portfolio reviews.
// Holdings-aware: web-search powered brief, flags news about tickers the user owns.
// Non-fatal: errors are logged per user inside sendDailyNewsBrief and never thrown.
function onNewsBriefTrigger() {
  try {
    NotificationAgent.sendDailyNewsBrief();
  } catch (e) {
    Logger.log('[Orchestrator] News brief trigger error: ' + e.message);
    _logError('onNewsBriefTrigger', e);
  }
}

// Daily mutual-fund NAV refresh (8PM Bangkok). Additive + non-fatal: refreshMFNav
// logs & skips per-holding failures and never touches a manually-entered NAV.
function onMFNavTrigger() {
  try {
    DataAgent.refreshMFNav();
  } catch (e) {
    Logger.log('[Orchestrator] MF NAV trigger error: ' + e.message);
  }
}

// ── Mid-month revision check (run on 15th via daily trigger) ──────────────────

function onMidMonthCheck() {
  const today = new Date();
  if (today.getDate() === 15) {
    DCAAgent.checkMidMonthRevision();
  }
}

// ── One-time trigger setup ────────────────────────────────────────────────────

function setupTriggers() {
  // Delete all existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Daily 8AM Bangkok — morning data fetch (US prices = previous day's close)
  ScriptApp.newTrigger('onDailyTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // Daily 4AM Bangkok = ~5PM ET = 1h after US market close — captures today's closing prices
  ScriptApp.newTrigger('onDailyTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();

  // Every 5 minutes for real-time alerts (crypto ±5%, gold ±5%, S/R proximity)
  ScriptApp.newTrigger('onRealtimeTrigger')
    .timeBased()
    .everyMinutes(5)
    .create();

  // NOTE: the daily 7AM Tech-News brief trigger (onNewsBriefTrigger) was REMOVED
  // 2026-07-16 — the brief is now generated on demand from the Analysis › News tab
  // (web action `generateNewsBrief`) so the Claude API is only called when the user
  // actually wants to read it. onNewsBriefTrigger() still exists for manual runs.

  // Daily 8PM mutual-fund NAV refresh (atHour uses the project timezone — set it to
  // Asia/Bangkok in Project Settings so this fires at 20:00 Bangkok).
  ScriptApp.newTrigger('onMFNavTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .create();

  Logger.log('[Orchestrator] Triggers set up: daily@8AM + daily@4AM + every5min + mfNav@8PM (newsBrief@7AM removed — on-demand from the app)');
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

function supabaseRequest(method, path, payload) {
  const url = Config.SUPABASE_URL() + '/rest/v1/' + path;
  const options = {
    method: method,
    headers: Config.supabaseHeaders(),
    muteHttpExceptions: true
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code >= 400) {
    throw new Error(`Supabase ${method} ${path} → ${code}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

// INSERT … ON CONFLICT DO UPDATE — requires the merge-duplicates Prefer header
function supabaseUpsert(path, payload) {
  const url = Config.SUPABASE_URL() + '/rest/v1/' + path;
  const headers = Object.assign({}, Config.supabaseHeaders(), {
    'Prefer': 'return=representation,resolution=merge-duplicates'
  });
  const options = {
    method: 'POST',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code >= 400) {
    throw new Error(`Supabase UPSERT ${path} → ${code}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

// ── Error logging ─────────────────────────────────────────────────────────────

function _logError(source, error) {
  try {
    Logger.log(`[ERROR] ${source}: ${error.message}\n${error.stack}`);
  } catch (_) {}
}

// ── Manual test runners (run these from the GAS IDE to verify each agent) ─────

function testFetchAll() {
  DataAgent.fetchAll();
}

function testAnalystGrowth() {
  AnalystAgent.reviewGrowthPortfolios();
}

function testAnalystWeekly() {
  AnalystAgent.reviewDividendAndETF();
}

function testDCAGenerate() {
  DCAAgent.generatePlans();
}

function testNews() {
  NewsAgent.fetchForAllHoldings();
}

function testDailyTrigger() {
  onDailyTrigger();
}

function testWeeklyTrigger() {
  onWeeklyTrigger();
}
function testUpdateSRLevels() {
  DataAgent.updateDynamicSRLevels();
}

function testMonthlyTrigger() {
  onMonthlyTrigger();
}

function testRealtimeAlerts() {
  const alerts = DataAgent.checkRealtimeAlerts();
  Logger.log('[testRealtimeAlerts] ' + alerts.length + ' alert(s): ' + JSON.stringify(alerts));
}

// Sends the daily Tech-News brief to all users right now (verify web_search + Telegram).
function testNewsBrief() {
  NotificationAgent.sendDailyNewsBrief();
}

