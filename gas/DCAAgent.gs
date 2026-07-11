/**
 * DCAAgent.gs — Monthly DCA plan generation
 * Runs 1st of month. Mid-month check runs on 15th.
 */

const DCAAgent = (() => {

  function generatePlans() {
    Logger.log('[DCAAgent] Generating monthly DCA plans');
    const users = supabaseRequest('GET', 'users?select=id,name');
    if (!users) return;

    users.forEach(user => {
      try {
        _generatePlanForUser(user);
      } catch (e) {
        Logger.log(`[DCAAgent] Error for user ${user.id}: ${e.message}`);
      }
    });
  }

  function checkMidMonthRevision() {
    Logger.log('[DCAAgent] Mid-month revision check');
    const monthYear = _monthYear();

    const users = supabaseRequest('GET', 'users?select=id,telegram_chat_id');
    users?.forEach(user => {
      const plans = supabaseRequest('GET',
        `dca_plans?user_id=eq.${user.id}&month_year=eq.${monthYear}&status=eq.approved`);
      if (!plans || plans.length === 0) return;

      // Check if any growth holding moved ±10% since plan was created
      const planId = plans[0].id;
      const items = supabaseRequest('GET', `dca_plan_items?plan_id=eq.${planId}&select=ticker`);
      if (!items) return;

      const bigMoves = _detectBigMoves(items.map(i => i.ticker), 10);
      if (bigMoves.length > 0) {
        const msg = `⚡ Mid-month alert: ${bigMoves.map(m => `${m.ticker} ${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%`).join(', ')}. Consider reviewing your DCA plan in the app.`;
        NotificationAgent.sendToUser(user, msg);
      }
    });
  }

  // ── Per-user plan generation ────────────────────────────────────────────────

  function _generatePlanForUser(user) {
    const monthYear = _monthYear();

    // Skip if plan already exists
    const existing = supabaseRequest('GET',
      `dca_plans?user_id=eq.${user.id}&month_year=eq.${monthYear}`);
    if (existing && existing.length > 0) {
      Logger.log(`[DCAAgent] Plan already exists for user ${user.id} ${monthYear}`);
      return;
    }

    // Get growth portfolios only (DCA targets growth)
    const portfolios = supabaseRequest('GET',
      `portfolios?user_id=eq.${user.id}&type=eq.growth&select=id,dca_budget_usd`);
    if (!portfolios || portfolios.length === 0) return;

    const portfolio = portfolios[0];
    const budget = portfolio.dca_budget_usd || 0;
    if (budget <= 0) return;

    const holdings = supabaseRequest('GET',
      `holdings?portfolio_id=eq.${portfolio.id}&select=ticker,target_pct,shares,avg_cost_usd`);
    if (!holdings || holdings.length === 0) return;

    const prices = _getLatestPrices(holdings.map(h => h.ticker));

    // Gap analysis
    const totalValue = holdings.reduce((sum, h) => sum + h.shares * (prices[h.ticker] || h.avg_cost_usd), 0);
    const gaps = holdings.map(h => {
      const currentValue = h.shares * (prices[h.ticker] || 0);
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      return {
        ticker: h.ticker,
        target_pct: h.target_pct,
        current_pct: parseFloat(currentPct.toFixed(2)),
        gap_pct: h.target_pct ? parseFloat((h.target_pct - currentPct).toFixed(2)) : 0,
        current_price: prices[h.ticker] || 0,
        avg_cost: h.avg_cost_usd
      };
    }).filter(g => g.gap_pct !== null);

    // Recent news for context
    const news = _getRecentNews(holdings.map(h => h.ticker), 30);

    const prompt = _buildDCAPrompt(gaps, budget, news, monthYear);
    const planItems = _callClaude(prompt);
    if (!planItems) return;

    // Persist plan
    const plan = supabaseRequest('POST', 'dca_plans', {
      user_id: user.id,
      month_year: monthYear,
      status: 'draft',
      total_budget_usd: budget,
      created_at: new Date().toISOString()
    });

    if (plan && plan.length > 0) {
      const planId = plan[0].id;
      planItems.forEach(item => {
        supabaseRequest('POST', 'dca_plan_items', {
          plan_id: planId,
          ticker: item.ticker,
          suggested_amount_usd: item.amount,
          adjusted_amount_usd: null,
          reasoning: item.reasoning,
          is_approved: false
        });
      });
      Logger.log(`[DCAAgent] Created DCA plan ${planId} for user ${user.id}`);
    }
  }

  // ── Prompt ──────────────────────────────────────────────────────────────────

  function _buildDCAPrompt(gaps, budget, news, monthYear) {
    const newsText = news.slice(0, 20).map(n => `- [${n.ticker}] ${n.source_name}: ${n.title}`).join('\n') || 'None.';

    return `You are a DCA (dollar-cost averaging) investment planner. Generate a monthly DCA allocation plan.

MONTH: ${monthYear}
TOTAL DCA BUDGET: $${budget}

PORTFOLIO GAP ANALYSIS (positive gap = underweight vs target):
${JSON.stringify(gaps, null, 2)}

RECENT NEWS (last 30 days — do not fabricate, only use what's provided):
${newsText}

ALLOCATION RULES:
1. Prioritize tickers with the largest positive gap (most underweight)
2. Do not allocate to tickers that are already overweight (negative gap) unless there's a strong DCA reason
3. Minimum allocation per ticker: $20
4. Total of all allocations must equal exactly $${budget}
5. Adjust for any negative news (earnings miss, analyst downgrade) — reduce or skip that ticker

Return ONLY a valid JSON array:
[
  {
    "ticker": "GOOGL",
    "amount": 80.00,
    "reasoning": "Most underweight at -4.2% gap. No negative news. Priority buy."
  }
]

Sum of all "amount" values must equal ${budget}.`;
  }

  // ── Claude API ──────────────────────────────────────────────────────────────

  function _callClaude(prompt) {
    const url = 'https://api.anthropic.com/v1/messages';
    const options = {
      method: 'POST',
      headers: {
        'x-api-key': Config.CLAUDE_API_KEY(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'You are a DCA investment planner. Respond with valid JSON only, no markdown.',
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    if (resp.getResponseCode() !== 200) {
      Logger.log('[DCAAgent] Claude error: ' + resp.getContentText());
      return null;
    }

    const body = JSON.parse(resp.getContentText());
    const text = body.content?.[0]?.text;
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      const match = text.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _detectBigMoves(tickers, thresholdPct) {
    const moves = [];
    tickers.forEach(ticker => {
      const rows = supabaseRequest('GET',
        `market_data?symbol=eq.${ticker}&order=fetched_at.desc&limit=2`);
      if (!rows || rows.length < 2) return;
      const change = ((rows[0].price - rows[1].price) / rows[1].price) * 100;
      if (Math.abs(change) >= thresholdPct) {
        moves.push({ ticker, change });
      }
    });
    return moves;
  }

  function _getLatestPrices(tickers) {
    const prices = {};
    tickers.forEach(ticker => {
      const rows = supabaseRequest('GET',
        `market_data?symbol=eq.${ticker}&order=fetched_at.desc&limit=1`);
      if (rows && rows.length > 0) prices[ticker] = rows[0].price;
    });
    return prices;
  }

  function _getRecentNews(tickers, days) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const filter = tickers.map(t => `ticker.eq.${t}`).join(',');
    const rows = supabaseRequest('GET',
      `news_items?or=(${filter})&published_at=gte.${since}&order=published_at.desc&limit=40`);
    return rows || [];
  }

  function _monthYear() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // ── Month-completion email summary ──────────────────────────────────────────
  // Called from the web app (action=dcaEmailSummary) when the user ticks every
  // ticker across all portfolios and hits "Complete Month". Builds a plain-text
  // per-portfolio summary from dca_plans + dca_plan_items and emails the owner
  // via GmailApp (runs as the account owner; needs the Gmail send OAuth scope
  // declared in appsscript.json — re-authorize once after pasting).

  const _SUMMARY_EMAIL = 'chanika.cptk@gmail.com';

  // mode: 'submit' (progress snapshot — does NOT complete) | 'complete' (also
  // flags every plan for the month as completed). Per-ticker status icon:
  // ✅ done · 🔄 actual entered but not done · ⬜ not started.
  function emailMonthSummary(userId, monthYear, mode) {
    mode = mode || 'submit';
    if (!userId)    throw new Error('userId required');
    if (!monthYear) throw new Error('monthYear required');

    const plans = supabaseRequest('GET',
      `dca_plans?user_id=eq.${userId}&month_year=eq.${monthYear}` +
      `&select=id,total_budget_usd,portfolio_id&order=created_at`);
    if (!plans || plans.length === 0) throw new Error('No DCA plans for ' + monthYear);

    // Portfolio names
    const portIds = plans.map(p => p.portfolio_id).filter(Boolean);
    const portMap = {};
    if (portIds.length) {
      const ports = supabaseRequest('GET',
        `portfolios?id=in.(${portIds.join(',')})&select=id,name`);
      (ports || []).forEach(p => { portMap[p.id] = p.name; });
    }

    let grandPlanned = 0, grandActual = 0, grandDone = 0, grandTotal = 0;
    const sections = [];

    plans.forEach(plan => {
      const items = supabaseRequest('GET',
        `dca_plan_items?plan_id=eq.${plan.id}` +
        `&select=ticker,planned_amount_usd,actual_amount_usd,is_done`) || [];
      if (items.length === 0) return;

      const portName = portMap[plan.portfolio_id] || 'Portfolio';
      let secPlanned = 0, secActual = 0;
      const lines = items.map(it => {
        const planned = Number(it.planned_amount_usd) || 0;
        const actual  = Number(it.actual_amount_usd)  || 0;
        secPlanned += planned; secActual += actual;
        grandTotal += 1;
        let icon;
        if (it.is_done)     { icon = '✅'; grandDone += 1; }
        else if (actual > 0)  icon = '🔄';
        else                  icon = '⬜';
        return `${icon} ${it.ticker}: Planned ${_usd(planned)} · Actual ${_usd(actual)}`;
      });
      grandPlanned += secPlanned; grandActual += secActual;

      sections.push(
        `${portName} Portfolio\n` +
        lines.map(l => '  ' + l).join('\n') +
        `\n  Total ${portName}: Planned ${_usd(secPlanned)} · Actual ${_usd(secActual)}`
      );
    });

    if (sections.length === 0) throw new Error('No plan items to summarise');

    const label   = _monthLabel(monthYear);
    const subject = `MyAsset+ DCA Summary — ${label} (${grandDone}/${grandTotal} completed)`;
    const body =
      `DCA Summary — ${label}\n` +
      `Legend: ✅ completed · 🔄 in progress · ⬜ not started\n\n` +
      sections.join('\n\n') +
      `\n\n─────────────────────\n` +
      `Grand Total: Planned ${_usd(grandPlanned)} · Actual ${_usd(grandActual)}\n` +
      `Completion: ${grandDone}/${grandTotal} tickers fully done\n\n` +
      `Sent from MyAsset+`;

    GmailApp.sendEmail(_SUMMARY_EMAIL, subject, body);
    Logger.log(`[DCAAgent] Sent DCA ${mode} summary for ${monthYear} to ${_SUMMARY_EMAIL}`);

    // Only "complete" flags the month's plans as completed
    if (mode === 'complete') {
      plans.forEach(plan => {
        supabaseRequest('PATCH', `dca_plans?id=eq.${plan.id}`, { status: 'completed' });
      });
    }

    return { sent: true, month: monthYear, mode: mode, done: grandDone, total: grandTotal, portfolios: sections.length };
  }

  function _usd(v) {
    return '$' + (Number(v) || 0).toLocaleString('en-US',
      { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function _monthLabel(monthYear) {
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const parts = (monthYear || '').split('-');
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (!y || !m) return monthYear;
    return `${MONTHS[m - 1]} ${y}`;
  }

  return { generatePlans, checkMidMonthRevision, emailMonthSummary };
})();
