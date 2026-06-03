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
    } else if (action === 'testTelegram') {
      const userId = e?.parameter?.userId;
      result.sent = _sendTestTelegram(userId);
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

  // Look up user record for name + chat_id
  const users = supabaseRequest('GET', `users?id=eq.${userId}&select=name,telegram_chat_id`);
  if (!users || users.length === 0) throw new Error('User not found: ' + userId);

  const user = users[0];
  if (!user.telegram_chat_id) throw new Error('No Telegram Chat ID saved for this user');

  // Bangkok time (UTC+7)
  const bangkokTime = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toUTCString()
    .replace('GMT', '+07:00')
    .replace(/:\d{2} /, ' ');

  const msg =
    '🤖 *Smart Me — Test Alert*\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '✅ Telegram connected successfully\\!\n' +
    `👤 User: ${user.name}\n` +
    `🕐 Time: ${bangkokTime}\n` +
    '📡 Status: All systems operational\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '_Smart Me Asset Tracker_';

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: user.telegram_chat_id,
      text: msg,
      parse_mode: 'MarkdownV2'
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(resp.getContentText());
  if (!body.ok) throw new Error('Telegram error: ' + body.description);
  return true;
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
        AnalystAgent.reviewGrowthPortfolios();
        NewsAgent.fetchForAllHoldings();
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
    AnalystAgent.reviewDividendAndETF();
    NewsAgent.fetchForAllHoldings();
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

function testMonthlyTrigger() {
  onMonthlyTrigger();
}

function testRealtimeAlerts() {
  const alerts = DataAgent.checkRealtimeAlerts();
  Logger.log('[testRealtimeAlerts] ' + alerts.length + ' alert(s): ' + JSON.stringify(alerts));
}
