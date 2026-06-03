/**
 * Code.gs — Orchestrator
 *
 * TRIGGER SETUP (one-time, run setupTriggers() from the GAS IDE):
 *   - Daily 8AM weekdays  → onDailyTrigger
 *   - Every Monday 8AM    → onWeeklyTrigger  (also fires from daily on Mondays)
 *   - 1st of month 7AM    → onMonthlyTrigger (checked inside daily trigger)
 *   - Every 5 minutes     → onRealtimeTrigger
 */

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
