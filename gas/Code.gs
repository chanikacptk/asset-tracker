/**
 * Code.gs — Orchestrator
 *
 * TRIGGER SETUP (one-time, run setupTriggers() from the GAS IDE):
 *   - Daily 8AM weekdays  → onDailyTrigger
 *   - Every Monday 8AM    → onWeeklyTrigger  (also fires from daily on Mondays)
 *   - 1st of month 7AM    → onMonthlyTrigger (checked inside daily trigger)
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
    } else if (action === 'savePrice') {
      const symbol = (e?.parameter?.symbol || '').toUpperCase();
      const price  = parseFloat(e?.parameter?.price || '0');
      const asset_type = e?.parameter?.asset_type || 'stock';
      const currency   = e?.parameter?.currency   || 'USD';
      if (!symbol || !(price > 0)) throw new Error('symbol and price > 0 required');
      DataAgent.savePrice(symbol, price, asset_type, currency);
      result.saved = true;
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
    } else if (action === 'searchMFFund') {
      const fundCode = (e?.parameter?.fundCode || '').toUpperCase().trim();
      if (!fundCode) throw new Error('fundCode required');
      const info = DataAgent.searchSECFund(fundCode);
      if (!info) throw new Error('Fund not found in SEC database — enter details manually');
      result.fundInfo = info;
    } else if (action === 'matchMFFund') {
      const fundName  = (e?.parameter?.fundName  || '').trim();
      const holdingId = (e?.parameter?.holdingId || '').trim();
      if (!fundName) throw new Error('fundName required');
      const match = DataAgent.matchSECFundByName(fundName);
      result.match = match || null;
      if (match?.fundCode && holdingId) {
        // Update fund_code directly in Supabase (service_role bypasses RLS)
        supabaseRequest('PATCH',
          'mutual_fund_holdings?id=eq.' + holdingId,
          { fund_code: match.fundCode }
        );
        // Fetch and persist NAV immediately so card shows live value
        DataAgent.fetchNavForSingleFund(match.fundCode);
        result.updated = true;
      }
    } else if (action === 'fetchThaiMutualFunds') {
      DataAgent.fetchThaiMutualFunds();
    } else if (action === 'ping') {
      result.message = 'Smart Me GAS is alive';
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
      '🤖 <b>Smart Me — Test Alert</b>\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '✅ Telegram connected successfully!\n' +
      `👤 User: ${user.name}\n` +
      `🕐 Time: ${bangkokTime}\n` +
      '📡 Status: All systems operational\n' +
      '━━━━━━━━━━━━━━━━━━\n' +
      '<i>Smart Me Asset Tracker</i>';

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
      // Daily growth portfolio review (skip Sat/Sun)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        AnalystAgent.reviewAllPortfolios();
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
    AnalystAgent.reviewAllPortfolios();
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

  // Daily 8AM (Mon–Sun; weekday logic is inside onDailyTrigger)
  ScriptApp.newTrigger('onDailyTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // Every 5 minutes for real-time alerts (crypto ±5%, gold ±5%, S/R proximity)
  ScriptApp.newTrigger('onRealtimeTrigger')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('[Orchestrator] Triggers set up: daily@8AM + every5min');
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

function testFetchThaiMutualFunds() {
  DataAgent.fetchThaiMutualFunds();
}

function testSECApi() {
  DataAgent.testSECApi();
}

function testMatchMFFund() {
  // Edit the fund name below to test name→code matching
  const match = DataAgent.matchSECFundByName('KKP CorePath Balanced');
  Logger.log('[testMatchMFFund] result: ' + JSON.stringify(match));
}

function testRealtimeAlerts() {
  const alerts = DataAgent.checkRealtimeAlerts();
  Logger.log('[testRealtimeAlerts] ' + alerts.length + ' alert(s): ' + JSON.stringify(alerts));
}
