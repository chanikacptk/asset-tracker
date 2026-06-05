/**
 * NotificationAgent.gs — Telegram notifications
 * Per-user, per-portfolio grouping. Includes AI signals, S/R levels, and news.
 */

const NotificationAgent = (() => {

  // ── Public ──────────────────────────────────────────────────────────────────

  function sendDailyGrowthReview() {
    _getUsersWithTelegram().forEach(user => {
      try {
        const portfolios = _getPortfoliosByType(user.id, 'growth');
        if (portfolios.length === 0) return;

        const sections = [];
        portfolios.forEach(portfolio => {
          const analyses = _getLatestAnalysesForPortfolio(portfolio.id, 1);
          if (analyses.length === 0) return;

          const news = _getHighImpactNews(analyses.map(a => a.ticker), 2);
          let block = `📁 *${portfolio.name}*\n`;

          analyses.forEach(a => {
            block += `\n${_signalEmoji(a.signal)} *${a.ticker}* — ${a.signal}\n`;
            block += `_${(a.reasoning || '').slice(0, 150)}_\n`;
            const sr = [];
            if (a.support_level)    sr.push(`S: $${a.support_level}`);
            if (a.resistance_level) sr.push(`R: $${a.resistance_level}`);
            if (sr.length) block += `📐 ${sr.join(' · ')}\n`;
          });

          if (news.length > 0) {
            block += `\n📰 *News*\n`;
            news.slice(0, 3).forEach(n => {
              block += `• *${n.ticker}*: ${n.source_name} — ${n.title.slice(0, 80)}\n`;
            });
          }
          sections.push(block);
        });

        if (sections.length === 0) return;
        const msg = `📊 *Daily Growth Review — ${_dateLabel()}*\n\n` +
          sections.join('\n─────────────\n');
        _send(user.telegram_chat_id, msg);
        _logNotification(user.id, 'daily_review', msg);
      } catch (e) {
        Logger.log(`[NotificationAgent] sendDailyGrowthReview error (${user.id}): ${e.message}`);
      }
    });
  }

  function sendWeeklyReview() {
    _getUsersWithTelegram().forEach(user => {
      try {
        const portfolios = [
          ..._getPortfoliosByType(user.id, 'dividend'),
          ..._getPortfoliosByType(user.id, 'etf')
        ];
        if (portfolios.length === 0) return;

        const sections = [];
        portfolios.forEach(portfolio => {
          const analyses = _getLatestAnalysesForPortfolio(portfolio.id, 7);
          if (analyses.length === 0) return;

          const news = _getHighImpactNews(analyses.map(a => a.ticker), 7);
          let block = `📁 *${portfolio.name}*\n`;

          analyses.forEach(a => {
            block += `\n${_signalEmoji(a.signal)} *${a.ticker}* — ${a.signal}: _${(a.reasoning || '').slice(0, 120)}_\n`;
            const sr = [];
            if (a.support_level)    sr.push(`S: $${a.support_level}`);
            if (a.resistance_level) sr.push(`R: $${a.resistance_level}`);
            if (sr.length) block += `📐 ${sr.join(' · ')}\n`;
          });

          if (news.length > 0) {
            block += `\n📰 *News (7d)*\n`;
            news.slice(0, 4).forEach(n => {
              block += `• *${n.ticker}*: ${n.source_name} — ${n.title.slice(0, 80)}\n`;
            });
          }
          sections.push(block);
        });

        if (sections.length === 0) return;
        const msg = `📅 *Weekly Review — ${_dateLabel()}*\n\n` +
          sections.join('\n─────────────\n');
        _send(user.telegram_chat_id, msg);
        _logNotification(user.id, 'weekly_review', msg);
      } catch (e) {
        Logger.log(`[NotificationAgent] sendWeeklyReview error (${user.id}): ${e.message}`);
      }
    });
  }

  // Called after NewsAgent.fetchForAllHoldings() — sends only articles from the last 6h
  // Skipped during quiet hours (10PM–7AM Bangkok)
  function sendHighImpactNewsAlerts() {
    if (_isQuietHours()) {
      Logger.log('[NotificationAgent] Quiet hours — skipping news alerts');
      return;
    }
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const news = supabaseRequest('GET',
      `news_items?is_high_impact=eq.true&created_at=gte.${since}&order=published_at.desc&limit=20`);
    if (!news || news.length === 0) return;

    _getUsersWithTelegram().forEach(user => {
      try {
        // Find only tickers this user holds
        const portRows = supabaseRequest('GET',
          `portfolios?user_id=eq.${user.id}&select=id`) || [];
        if (portRows.length === 0) return;

        const portFilter = portRows.map(p => `portfolio_id.eq.${p.id}`).join(',');
        const holdings = supabaseRequest('GET',
          `holdings?or=(${portFilter})&select=ticker`) || [];
        const userTickers = new Set(holdings.map(h => h.ticker));

        const relevant = news.filter(n => userTickers.has(n.ticker));
        if (relevant.length === 0) return;

        const lines = relevant.slice(0, 5).map(n =>
          `⚡ *${n.ticker}*: ${n.source_name}\n_${n.title.slice(0, 100)}_`
        );
        const msg = `🔔 *Breaking News — ${_timeLabel()}*\n\n` + lines.join('\n\n');
        _send(user.telegram_chat_id, msg);
        _logNotification(user.id, 'breaking_news', msg);
      } catch (e) {
        Logger.log(`[NotificationAgent] sendHighImpactNewsAlerts error (${user.id}): ${e.message}`);
      }
    });
  }

  function sendRealtimeAlerts(alerts) {
    if (_isQuietHours()) {
      Logger.log('[NotificationAgent] Quiet hours — skipping realtime alerts');
      return;
    }

    const users = _getUsersWithTelegram();

    // Higher number = lower priority (crypto most urgent, gold least)
    const PRIORITY = { crypto_alert: 0, sr_alert: 1, gold_alert: 2 };
    alerts.sort((a, b) => (PRIORITY[a.type] ?? 99) - (PRIORITY[b.type] ?? 99));

    alerts.forEach(alert => {
      const targets = alert.user_id
        ? users.filter(u => u.id === alert.user_id)
        : users;
      const msg = _formatAlert(alert);
      if (!msg) return;

      const ticker = alert.symbol || 'GENERAL';

      targets.forEach(user => {
        try {
          if (_getAlertCountToday(user.id) >= 5) {
            Logger.log(`[NotificationAgent] Daily cap (5) reached for ${user.id}`);
            return;
          }
          if (_isCooldown(user.id, ticker, alert.type)) {
            Logger.log(`[NotificationAgent] 24h cooldown: ${ticker} ${alert.type} for ${user.id}`);
            return;
          }
          _send(user.telegram_chat_id, msg);
          _logNotification(user.id, 'realtime_alert', msg);
          _markCooldown(user.id, ticker, alert.type);
        } catch (e) {
          Logger.log(`[NotificationAgent] sendRealtimeAlerts error (${user.id}): ${e.message}`);
        }
      });
    });
  }

  function sendToUser(user, message) {
    if (!user.telegram_chat_id) return;
    _send(user.telegram_chat_id, message);
    _logNotification(user.id, 'dca_notification', message);
  }

  // ── Noise-reduction helpers ──────────────────────────────────────────────────

  // Returns true between 10PM and 7AM Bangkok time (UTC+7)
  function _isQuietHours() {
    const bangkokHour = (new Date().getUTCHours() + 7) % 24;
    return bangkokHour >= 22 || bangkokHour < 7;
  }

  // Check if a same alert was already sent within the last 24 hours
  function _isCooldown(userId, ticker, alertType) {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rows = supabaseRequest('GET',
        `alert_cooldowns?user_id=eq.${userId}&ticker=eq.${encodeURIComponent(ticker)}&alert_type=eq.${alertType}&last_sent_at=gte.${cutoff}`);
      return rows && rows.length > 0;
    } catch (e) {
      return false; // fail open so alerts still go through on DB error
    }
  }

  // Upsert the cooldown timestamp for this user+ticker+type
  function _markCooldown(userId, ticker, alertType) {
    try {
      supabaseUpsert('alert_cooldowns?on_conflict=user_id,ticker,alert_type', {
        user_id:      userId,
        ticker:       ticker,
        alert_type:   alertType,
        last_sent_at: new Date().toISOString()
      });
    } catch (e) {
      Logger.log('[NotificationAgent] _markCooldown failed: ' + e.message);
    }
  }

  // Count realtime alerts sent to this user today (UTC midnight boundary)
  function _getAlertCountToday(userId) {
    try {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const rows = supabaseRequest('GET',
        `notifications_log?user_id=eq.${userId}&notification_type=eq.realtime_alert&sent_at=gte.${todayStart.toISOString()}&select=id`);
      return rows ? rows.length : 0;
    } catch (e) {
      return 0; // fail open
    }
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

  // ── Data helpers ─────────────────────────────────────────────────────────────

  function _getPortfoliosByType(userId, type) {
    return supabaseRequest('GET',
      `portfolios?user_id=eq.${userId}&type=eq.${type}&select=id,name`) || [];
  }

  function _getLatestAnalysesForPortfolio(portfolioId, days) {
    const since = new Date(Date.now() - (days || 1) * 24 * 60 * 60 * 1000).toISOString();
    const rows = supabaseRequest('GET',
      `ai_analyses?portfolio_id=eq.${portfolioId}&created_at=gte.${since}&order=created_at.desc`) || [];
    // Deduplicate: latest per ticker
    const seen = {};
    return rows.filter(a => { if (seen[a.ticker]) return false; seen[a.ticker] = true; return true; });
  }

  function _getHighImpactNews(tickers, days) {
    if (!tickers || tickers.length === 0) return [];
    const since = new Date(Date.now() - (days || 2) * 24 * 60 * 60 * 1000).toISOString();
    const filter = tickers.map(t => `ticker.eq.${t}`).join(',');
    return supabaseRequest('GET',
      `news_items?or=(${filter})&is_high_impact=eq.true&published_at=gte.${since}&order=published_at.desc&limit=10`) || [];
  }

  function _getUsersWithTelegram() {
    return (supabaseRequest('GET', 'users?select=id,name,telegram_chat_id') || [])
      .filter(u => u.telegram_chat_id);
  }

  function _logNotification(userId, type, message) {
    try {
      supabaseRequest('POST', 'notifications_log', {
        user_id: userId,
        notification_type: type,
        message: message.slice(0, 1000),
        sent_at: new Date().toISOString(),
        status: 'sent'
      });
    } catch (e) {
      Logger.log('[NotificationAgent] Log error: ' + e.message);
    }
  }

  function _send(chatId, text) {
    if (!chatId) return;
    const token = Config.TELEGRAM_BOT_TOKEN();
    if (!token) { Logger.log('[NotificationAgent] TELEGRAM_BOT_TOKEN not set'); return; }
    const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log(`[NotificationAgent] Telegram error for ${chatId}: ${resp.getContentText()}`);
    }
  }

  function _signalEmoji(signal) {
    return { BUY: '🟢', SELL: '🔴', HOLD: '🟡', TRIM: '🟠' }[signal] || '⚪';
  }

  function _dateLabel() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function _timeLabel() {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000); // UTC+7 Bangkok
    return d.toISOString().slice(11, 16) + ' BKK';
  }

  return { sendDailyGrowthReview, sendWeeklyReview, sendHighImpactNewsAlerts, sendRealtimeAlerts, sendToUser };
})();
