/**
 * NotificationAgent.gs — Telegram Bot notifications
 * Per-user routing via telegram_chat_id stored in users table.
 */

const NotificationAgent = (() => {

  // ── Public send methods ─────────────────────────────────────────────────────

  function sendDailyGrowthReview() {
    const users = _getUsersWithTelegram();
    users.forEach(user => {
      const analyses = _getLatestAnalysesByType(user.id, 'growth');
      if (analyses.length === 0) return;

      const lines = analyses.map(a => {
        const emoji = _signalEmoji(a.signal);
        return `${emoji} *${a.ticker}* — ${a.signal}\n_${a.reasoning}_`;
      });

      const msg = `📊 *Daily Growth Review — ${_dateLabel()}*\n\n` + lines.join('\n\n');
      _send(user.telegram_chat_id, msg);
      _logNotification(user.id, 'daily_review', msg);
    });
  }

  function sendWeeklyReview() {
    const users = _getUsersWithTelegram();
    users.forEach(user => {
      const dividend = _getLatestAnalysesByType(user.id, 'dividend');
      const etf = _getLatestAnalysesByType(user.id, 'etf');
      const all = [...dividend, ...etf];
      if (all.length === 0) return;

      const lines = all.map(a => `${_signalEmoji(a.signal)} *${a.ticker}* — ${a.signal}: _${a.reasoning}_`);
      const msg = `📅 *Weekly Review — ${_dateLabel()}*\n\n` + lines.join('\n\n');
      _send(user.telegram_chat_id, msg);
      _logNotification(user.id, 'weekly_review', msg);
    });
  }

  function sendRealtimeAlerts(alerts) {
    const users = _getUsersWithTelegram();

    alerts.forEach(alert => {
      let targetUsers = users;

      // If alert has user_id, only send to that user
      if (alert.user_id) {
        targetUsers = users.filter(u => u.id === alert.user_id);
      }

      const msg = _formatAlert(alert);
      if (!msg) return;

      targetUsers.forEach(user => {
        _send(user.telegram_chat_id, msg);
        _logNotification(user.id, 'realtime_alert', msg);
      });
    });
  }

  function sendToUser(user, message) {
    if (!user.telegram_chat_id) return;
    _send(user.telegram_chat_id, message);
    _logNotification(user.id, 'dca_notification', message);
  }

  // ── Alert formatters ────────────────────────────────────────────────────────

  function _formatAlert(alert) {
    if (alert.type === 'crypto_alert') {
      const dir = alert.change_pct > 0 ? '📈' : '📉';
      return `⚠️ *CRYPTO ALERT*\n${dir} *${alert.symbol}* ${alert.change_pct > 0 ? '+' : ''}${alert.change_pct.toFixed(1)}% in ${alert.window}\nCurrent: $${alert.price.toLocaleString()}`;
    }
    if (alert.type === 'gold_alert') {
      const dir = alert.change_pct > 0 ? '📈' : '📉';
      return `⚠️ *GOLD ALERT*\n${dir} *XAU/USD* ${alert.change_pct > 0 ? '+' : ''}${alert.change_pct.toFixed(1)}% today\nCurrent: $${alert.price.toLocaleString()}`;
    }
    if (alert.type === 'sr_alert') {
      return `🎯 *S/R ALERT — ${alert.symbol}*\nPrice $${alert.price} approaching ${alert.level_type} at $${alert.level}`;
    }
    return null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _send(chatId, text) {
    if (!chatId) return;
    const token = Config.TELEGRAM_BOT_TOKEN();
    if (!token) {
      Logger.log('[NotificationAgent] TELEGRAM_BOT_TOKEN not set');
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      }),
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    if (resp.getResponseCode() !== 200) {
      Logger.log(`[NotificationAgent] Telegram error for ${chatId}: ${resp.getContentText()}`);
    }
  }

  function _getLatestAnalysesByType(userId, portfolioType) {
    const portfolios = supabaseRequest('GET',
      `portfolios?user_id=eq.${userId}&type=eq.${portfolioType}&select=id`);
    if (!portfolios || portfolios.length === 0) return [];

    const ids = portfolios.map(p => `portfolio_id.eq.${p.id}`).join(',');
    // Get analyses from the last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const analyses = supabaseRequest('GET',
      `ai_analyses?or=(${ids})&created_at=gte.${since}&order=created_at.desc`);
    return analyses || [];
  }

  function _getUsersWithTelegram() {
    const users = supabaseRequest('GET', 'users?select=id,name,telegram_chat_id');
    return (users || []).filter(u => u.telegram_chat_id);
  }

  function _logNotification(userId, type, message) {
    try {
      supabaseRequest('POST', 'notifications_log', {
        user_id: userId,
        notification_type: type,
        message: message.slice(0, 1000), // truncate for storage
        sent_at: new Date().toISOString(),
        status: 'sent'
      });
    } catch (e) {
      Logger.log('[NotificationAgent] Log error: ' + e.message);
    }
  }

  function _signalEmoji(signal) {
    return { BUY: '🟢', SELL: '🔴', HOLD: '🟡', TRIM: '🟠' }[signal] || '⚪';
  }

  function _dateLabel() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  return { sendDailyGrowthReview, sendWeeklyReview, sendRealtimeAlerts, sendToUser };
})();
