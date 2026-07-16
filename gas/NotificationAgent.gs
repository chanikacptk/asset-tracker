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

  // ── Daily Tech-News brief (holdings-aware, web-search powered) ────────────────
  // Separate from the portfolio reviews. Run by onNewsBriefTrigger every morning.
  // For each user: gather their holdings → ask Claude (with the web_search tool) for
  // today's top tech/market stories → flag holdings-related ones at the top → send.
  // Holdings-aware: stories about a ticker the user owns lead the brief with a 🎯.

  const _NEWS_SYSTEM =
    'You are the editor of a daily Thai-language tech & markets news brief for a retail ' +
    'investor whose portfolio is concentrated in US tech / AI / semiconductors. You write ' +
    'punchy one-line summaries that mix Thai with English financial terms, ALWAYS include ' +
    'concrete numbers (revenue, EPS, %, guidance) and the market reaction (e.g. "+15% AH", ' +
    '"-3% premarket"). Tone: a sharp trading-desk bot. You MUST use the web_search tool to ' +
    'find TODAY\'S real news before writing — never fabricate a headline, number, or move. ' +
    'Respond with ONLY a JSON object — no markdown code fences, no prose before or after.';

  function sendDailyNewsBrief() {
    const users = _getUsersWithTelegram();
    if (users.length === 0) { Logger.log('[NewsBrief] no users with telegram'); return; }

    users.forEach(user => {
      try {
        const ctx = _getUserHoldingsForBrief(user.id);
        const prompt = _buildNewsBriefPrompt(ctx);
        let data = _callClaudeWebSearch(_NEWS_SYSTEM, prompt);
        if (!data) {
          Logger.log(`[NewsBrief] first attempt failed for ${user.name} — retrying once`);
          data = _callClaudeWebSearch(_NEWS_SYSTEM, prompt);
        }
        if (!data) { Logger.log(`[NewsBrief] no brief generated for ${user.name}`); return; }

        const msg = _renderNewsBrief(data);
        if (!msg) { Logger.log(`[NewsBrief] empty brief for ${user.name}`); return; }

        _sendHtml(user.telegram_chat_id, msg.slice(0, 4090));
        _logNotification(user.id, 'news_brief', msg);
        _persistNewsBrief(user.id, data); // for the Analysis page history (non-fatal)
        Logger.log(`[NewsBrief] sent to ${user.name}: ` +
          `${(data.holdings_stories || []).length} holdings + ` +
          `${(data.market_stories || []).length} market stories`);
      } catch (e) {
        Logger.log(`[NotificationAgent] sendDailyNewsBrief error (${user.id}): ${e.message}`);
      }
    });
  }

  // On-demand generation for the web app: build + persist a brief for ONE user,
  // WITHOUT sending Telegram (the daily 7AM push was removed 2026-07-16 — the app
  // now generates on demand from the Analysis › News tab). Returns a small summary
  // object for the frontend to toast. Never throws.
  function generateNewsBriefForUser(userId) {
    if (!userId) return { ok: false, error: 'userId required' };
    try {
      const ctx = _getUserHoldingsForBrief(userId);
      const prompt = _buildNewsBriefPrompt(ctx);
      let data = _callClaudeWebSearch(_NEWS_SYSTEM, prompt);
      if (!data) {
        Logger.log('[NewsBrief] on-demand first attempt failed — retrying once');
        data = _callClaudeWebSearch(_NEWS_SYSTEM, prompt);
      }
      if (!data) return { ok: false, error: 'no brief generated' };

      _persistNewsBrief(userId, data); // Analysis page history (non-fatal)
      _logNotification(userId, 'news_brief', _renderNewsBrief(data) || 'news brief (on-demand)');
      return {
        ok: true,
        date: _bkkIsoDate(),
        holdings: (data.holdings_stories || []).length,
        market: (data.market_stories || []).length
      };
    } catch (e) {
      Logger.log('[NotificationAgent] generateNewsBriefForUser error: ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  // Gather what the user holds: US tickers (growth/dividend/etf) drive 🎯 matching;
  // Thai mutual-fund names are passed as secondary awareness only.
  function _getUserHoldingsForBrief(userId) {
    let tickers = [];
    try {
      const ports = supabaseRequest('GET', `portfolios?user_id=eq.${userId}&select=id`) || [];
      if (ports.length) {
        const filter = ports.map(p => `portfolio_id.eq.${p.id}`).join(',');
        const holdings = supabaseRequest('GET',
          `holdings?or=(${filter})&select=ticker`) || [];
        tickers = [...new Set(holdings.map(h => h.ticker).filter(Boolean))];
      }
    } catch (e) {
      Logger.log('[NewsBrief] ticker fetch failed: ' + e.message);
    }

    let fundsLine = '';
    try {
      const funds = supabaseRequest('GET',
        `mutual_fund_holdings?user_id=eq.${userId}&select=fund_name`) || [];
      const names = [...new Set(funds.map(f => f.fund_name).filter(Boolean))];
      if (names.length) {
        fundsLine = 'They also hold Thai mutual funds: ' + names.slice(0, 12).join(', ') +
          '. Only mention these if there is directly relevant global news (e.g. their ' +
          'underlying index/sector moves materially).';
      }
    } catch (e) { /* non-fatal */ }

    return { tickers, fundsLine };
  }

  function _buildNewsBriefPrompt(ctx) {
    const tickers = ctx.tickers || [];
    const holdingsLine = tickers.length ? tickers.join(', ') : '(none on record)';

    return `Today is ${_thaiDateLabel()} (${_bkkIsoDate()}, Bangkok time).

The investor's current US holdings (tickers to match against): ${holdingsLine}.
${ctx.fundsLine || ''}

TASK:
1. Use the web_search tool to find today's most market-moving tech / US-equity / semiconductor / AI news. Run several searches, e.g. "stock market news today", "US stock futures premarket movers", "<each held ticker> news today", "semiconductor AI chip news today", "earnings results today".
2. Find the most market-moving stories from roughly the last 24 hours. Be generous on holdings coverage: include a story for EVERY holdings ticker that has genuinely notable news today (up to ~8), most important first — these power a browsable web page, not just a chat. Add 3-4 of the biggest general-market stories on top.
3. If a story is about one of the holdings tickers above, put it in "holdings_stories" (these LEAD the brief). Everything else goes in "market_stories".
4. Each "summary": ONE line, Thai mixed with English financial terms, with concrete numbers AND the price reaction. Match this style exactly:
   "Micron Q3 FY2026 beat ครั้งประวัติศาสตร์: Revenue $41.5B (+346% YoY, est $35.8B), gross margin 84.9% แซง NVIDIA แล้ว (+15% AH)"
5. For holdings_stories ONLY, add a short Thai "impact" line on what it means for that position, e.g. "ผลต่อ position ของคุณ: เป็นบวก, peer comparison ดีขึ้น".
6. Choose a fitting emoji per story: 🚀 huge beat/surge, 📈 up, 📉 down, 🔴 bad news, ⚠️ risk, 💰 deal/M&A, 🤖 AI, 🏦 macro/Fed, 🛢️ energy, 📊 index/broad.

Return ONLY this JSON (no code fences):
{
  "holdings_stories": [{"emoji":"🚀","ticker":"NVDA","summary":"...","impact":"..."}],
  "market_stories":  [{"emoji":"📊","ticker":"SPX","summary":"..."}],
  "sources": ["Reuters","Bloomberg"]
}

Rules:
- Aim for 8-12 stories total across both arrays (more is fine if genuinely newsworthy) — but never pad with low-importance filler.
- Order each array most-important first (the chat brief shows only the top few; the web page shows them all).
- holdings_stories ONLY for tickers in the holdings list above; if there is no holdings news today, return holdings_stories: [].
- "ticker" with NO leading "$".
- Never invent numbers — every figure must come from a search result.`;
  }

  // Claude API call WITH the server-side web_search tool. Single request: the model
  // runs its searches internally and returns the final answer. Returns parsed JSON or null.
  function _callClaudeWebSearch(systemPrompt, userPrompt) {
    const payload = {
      model: 'claude-haiku-4-5', // cost optimization — news brief runs on Haiku (portfolio/DCA/ticker stay on Sonnet)
      max_tokens: 5000, // raised from 3500 — the full-set prompt (~8-12 stories) was truncating
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }]
    };

    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Config.CLAUDE_API_KEY(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('[NewsBrief] Claude API error: ' + resp.getContentText().slice(0, 400));
      return null;
    }

    const body = JSON.parse(resp.getContentText());
    if (body.stop_reason === 'max_tokens') {
      Logger.log('[NewsBrief] response hit max_tokens — JSON likely truncated; raise max_tokens');
    }
    // With web search the response interleaves text / server_tool_use / web_search_tool_result
    // blocks — concatenate every text block, then extract the JSON object.
    const text = (body.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch (_) {}
      }
      Logger.log('[NewsBrief] JSON parse failed: ' + text.slice(0, 300));
      return null;
    }
  }

  // Build the Telegram message (HTML parse mode — robust against the $, %, +, -, ()
  // and Thai text that would constantly break Markdown/MarkdownV2 escaping).
  // Telegram-only caps — keep the chat scannable. The Analysis page persists the FULL
  // set (see _persistNewsBrief), so trimming here doesn't lose anything from the history.
  const _TG_MAX_TOTAL = 6, _TG_MAX_HOLDINGS = 4;

  function _renderNewsBrief(data) {
    const hsAll = (data.holdings_stories || []).filter(s => s && s.summary);
    const msAll = (data.market_stories  || []).filter(s => s && s.summary);
    if (hsAll.length === 0 && msAll.length === 0) return null;

    // Holdings lead (cap 4), then fill remaining slots with top market stories.
    const hs = hsAll.slice(0, _TG_MAX_HOLDINGS);
    const ms = msAll.slice(0, Math.max(0, _TG_MAX_TOTAL - hs.length));
    const moreCount = (hsAll.length + msAll.length) - (hs.length + ms.length);

    let msg = `📰 <b>Tech News Daily — ${_escapeHtml(_thaiDateLabel())}</b>\n`;
    msg += '━━━━━━━━━━━━━━━━━━\n';

    if (hs.length) {
      msg += '\n🎯 <b>Related to your holdings:</b>\n';
      hs.forEach(s => {
        const tick = s.ticker ? `<b>$${_escapeHtml(s.ticker)}</b> — ` : '';
        msg += `\n${s.emoji || '•'} ${tick}${_escapeHtml(s.summary)}\n`;
        if (s.impact) msg += `   ↳ <i>${_escapeHtml(s.impact)}</i>\n`;
      });
    }

    if (ms.length) {
      msg += '\n📊 <b>Other market news:</b>\n';
      ms.forEach(s => {
        const tick = s.ticker ? `<b>$${_escapeHtml(s.ticker)}</b> — ` : '';
        msg += `\n${s.emoji || '•'} ${tick}${_escapeHtml(s.summary)}\n`;
      });
    }

    msg += '\n━━━━━━━━━━━━━━━━━━\n';
    if (moreCount > 0) msg += `📲 <i>+${moreCount} more in the app → Analysis</i>\n`;
    const sources = (data.sources || []).filter(Boolean);
    if (sources.length) msg += 'ที่มา: ' + sources.map(_escapeHtml).join(' · ');
    return msg;
  }

  // Persist the brief to daily_news + daily_news_impact so the Analysis page can show
  // history. Idempotent per (user, date): clears the day's rows first, then re-inserts.
  // Fully non-fatal — a DB hiccup here must never affect the Telegram send.
  function _persistNewsBrief(userId, data) {
    try {
      const newsDate = _bkkIsoDate();
      const holdings = (data.holdings_stories || []).filter(s => s && s.summary);
      const market   = (data.market_stories  || []).filter(s => s && s.summary);
      const sources  = (data.sources || []).filter(Boolean);

      // Idempotency: remove any rows already stored for this user+date.
      // (impact rows cascade-delete via the news_id FK)
      supabaseRequest('DELETE',
        `daily_news?user_id=eq.${userId}&news_date=eq.${newsDate}`);

      // Insert holdings stories first (they need impact rows), preserving order.
      let order = 0;
      const holdingRows = holdings.map(s => ({
        user_id: userId, news_date: newsDate,
        emoji: s.emoji || '', ticker: s.ticker || null,
        headline: s.summary, sentiment: _sentimentFromEmoji(s.emoji),
        is_holding_related: true, sources: sources, sort_order: order++
      }));
      const marketRows = market.map(s => ({
        user_id: userId, news_date: newsDate,
        emoji: s.emoji || '', ticker: s.ticker || null,
        headline: s.summary, sentiment: _sentimentFromEmoji(s.emoji),
        is_holding_related: false, sources: sources, sort_order: order++
      }));

      // Bulk insert holdings rows; PostgREST returns them in input order with ids.
      const insertedHoldings = holdingRows.length
        ? (supabaseRequest('POST', 'daily_news', holdingRows) || [])
        : [];
      if (marketRows.length) supabaseRequest('POST', 'daily_news', marketRows);

      // Impact rows — one per holdings story that carried an impact line.
      const impactRows = [];
      insertedHoldings.forEach((row, i) => {
        const impact = holdings[i] && holdings[i].impact;
        if (row && row.id && impact) {
          impactRows.push({ news_id: row.id, user_id: userId, impact: impact });
        }
      });
      if (impactRows.length) supabaseRequest('POST', 'daily_news_impact', impactRows);

      Logger.log(`[NewsBrief] persisted ${holdingRows.length + marketRows.length} stories (${newsDate})`);
    } catch (e) {
      Logger.log('[NewsBrief] persist failed (non-fatal): ' + e.message);
    }
  }

  // Map a story emoji to a sentiment bucket (drives the Analysis card color).
  function _sentimentFromEmoji(emoji) {
    const e = emoji || '';
    if ('🚀📈💰✅🟢🔼🆙'.indexOf(e) >= 0) return 'positive';
    if ('🔴📉⚠️🔻🟥❌'.indexOf(e) >= 0)   return 'negative';
    return 'neutral'; // 🤖 🏦 📊 🛢️ ⚪ etc.
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Thai Buddhist-era date label, e.g. "25 มิ.ย. 2569" (deterministic, no locale dependency)
  function _thaiDateLabel() {
    const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                       'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000); // shift to Bangkok, read as UTC
    return `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
  }

  function _bkkIsoDate() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    if (!Config.TELEGRAM_ENABLED()) return; // all Telegram sends paused — see Config.TELEGRAM_ENABLED
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

  // Same as _send but parse_mode=HTML (used by the news brief — content is pre-escaped).
  function _sendHtml(chatId, text) {
    if (!Config.TELEGRAM_ENABLED()) return; // all Telegram sends paused — see Config.TELEGRAM_ENABLED
    if (!chatId) return;
    const token = Config.TELEGRAM_BOT_TOKEN();
    if (!token) { Logger.log('[NotificationAgent] TELEGRAM_BOT_TOKEN not set'); return; }
    const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log(`[NotificationAgent] Telegram HTML error for ${chatId}: ${resp.getContentText()}`);
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

  return { sendDailyGrowthReview, sendWeeklyReview, sendHighImpactNewsAlerts, sendRealtimeAlerts, sendToUser, sendDailyNewsBrief, generateNewsBriefForUser };
})();
