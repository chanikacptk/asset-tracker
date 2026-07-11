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

  // ── Month export to Google Sheets ───────────────────────────────────────────
  // Called from the web app (action=dcaExportSheet) when the user hits
  // "Export to Google Sheets". Reads dca_plans + dca_plan_items for the month and
  // appends one row per ticker per portfolio (plus a per-month TOTAL summary row)
  // to a single spreadsheet named 'MyAsset+ DCA History'. The spreadsheet id is
  // remembered in Script Properties (DCA_SHEET_ID) so subsequent months append to
  // the same file; the sheet is created automatically on the first export.
  // Needs the spreadsheets + drive.file OAuth scopes in appsscript.json
  // (re-authorize once after pasting).

  const _SHEET_NAME   = 'MyAsset+ DCA History';
  const _SHEET_HEADER = ['Month', 'Portfolio', 'Ticker', 'Suggested', 'Planned',
                         'Actual', 'Done', 'Export Date'];
  const _SHEET_TZ     = 'Asia/Bangkok';

  // Export one portfolio (portfolioId given) or every portfolio (omitted) for the
  // month. Each portfolio goes to its own tab inside the one spreadsheet, named
  // after the portfolio; rows for successive months are appended below the tab.
  function exportDCAToSheet(userId, monthYear, portfolioId) {
    if (!userId)    throw new Error('userId required');
    if (!monthYear) throw new Error('monthYear required');

    let query = `dca_plans?user_id=eq.${userId}&month_year=eq.${monthYear}` +
                `&select=id,portfolio_id&order=created_at`;
    if (portfolioId) query += `&portfolio_id=eq.${portfolioId}`;
    const plans = supabaseRequest('GET', query);
    if (!plans || plans.length === 0) throw new Error('No DCA plans for ' + monthYear);

    // Portfolio names → tab names
    const portIds = plans.map(p => p.portfolio_id).filter(Boolean);
    const portMap = {};
    if (portIds.length) {
      const ports = supabaseRequest('GET',
        `portfolios?id=in.(${portIds.join(',')})&select=id,name`);
      (ports || []).forEach(p => { portMap[p.id] = p.name; });
    }

    const monthShort = _monthShort(monthYear);
    const exportDate = Utilities.formatDate(new Date(), _SHEET_TZ, 'yyyy-MM-dd');
    const ss = _getOrCreateDCASheet();

    const results = [];
    let grandDone = 0, grandTotal = 0;
    plans.forEach(plan => {
      const portName = portMap[plan.portfolio_id] || 'Portfolio';
      const r = _exportPlanToTab(ss, plan.id, monthShort, exportDate, portName);
      if (r) { results.push(r); grandDone += r.done; grandTotal += r.total; }
    });

    if (results.length === 0) throw new Error('No plan items to export');
    _cleanupDefaultSheet(ss);

    Logger.log(`[DCAAgent] Exported ${grandTotal} tickers across ${results.length} tab(s) for ${monthYear} to "${_SHEET_NAME}" (${ss.getUrl()})`);
    return {
      exported: true, month: monthYear, sheetName: _SHEET_NAME, url: ss.getUrl(),
      portfolios: results, done: grandDone, total: grandTotal
    };
  }

  // Append one portfolio's plan to its own tab (created + headed on first write).
  function _exportPlanToTab(ss, planId, monthShort, exportDate, portName) {
    const items = supabaseRequest('GET',
      `dca_plan_items?plan_id=eq.${planId}` +
      `&select=ticker,suggested_amount_usd,planned_amount_usd,actual_amount_usd,is_done`) || [];
    if (items.length === 0) return null;

    let planned = 0, actual = 0, done = 0;
    const rows = [];
    items.forEach(it => {
      const suggested = Number(it.suggested_amount_usd) || 0;
      const p = Number(it.planned_amount_usd) || 0;
      const a = Number(it.actual_amount_usd)  || 0;
      planned += p; actual += a;
      if (it.is_done) done += 1;
      rows.push([
        monthShort, portName, it.ticker,
        suggested > 0 ? suggested : '—',
        p, a, it.is_done ? '✓' : '', exportDate
      ]);
    });
    // Per-month summary row for this portfolio tab
    rows.push([
      monthShort, portName, 'TOTAL', '—',
      '$' + planned + ' planned', '$' + actual + ' actual',
      done + '/' + items.length + ' done', '—'
    ]);

    const sheet = _getOrCreateDCATab(ss, portName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, _SHEET_HEADER.length).setValues([_SHEET_HEADER]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, _SHEET_HEADER.length).setValues(rows);
    return { portfolio: portName, rows: rows.length - 1, done: done, total: items.length };
  }

  // Get (or create) the tab for a portfolio; sheet names can't contain [ ] * ? / \ :
  function _getOrCreateDCATab(ss, name) {
    const safe = String(name).replace(/[\[\]\*\?\/\\:]/g, ' ').trim().slice(0, 90) || 'Portfolio';
    return ss.getSheetByName(safe) || ss.insertSheet(safe);
  }

  // A freshly created spreadsheet carries an empty default "Sheet1" — drop it once
  // real portfolio tabs exist so the file only shows the tabs that matter.
  function _cleanupDefaultSheet(ss) {
    if (ss.getSheets().length < 2) return;
    const def = ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0) ss.deleteSheet(def);
  }

  // Reuse the same spreadsheet across months: try the remembered id first, then a
  // by-name lookup (files this script has touched), else create a fresh sheet.
  function _getOrCreateDCASheet() {
    const props = PropertiesService.getScriptProperties();
    const id    = props.getProperty('DCA_SHEET_ID');
    if (id) {
      try { return SpreadsheetApp.openById(id); } catch (_) { /* stale id — fall through */ }
    }
    let ss = null;
    try {
      const files = DriveApp.getFilesByName(_SHEET_NAME);
      if (files.hasNext()) ss = SpreadsheetApp.open(files.next());
    } catch (_) { /* drive.file may not surface it — create instead */ }
    if (!ss) ss = SpreadsheetApp.create(_SHEET_NAME);
    props.setProperty('DCA_SHEET_ID', ss.getId());
    return ss;
  }

  function _monthShort(monthYear) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = (monthYear || '').split('-');
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (!y || !m) return monthYear;
    return `${MONTHS[m - 1]} ${y}`;
  }

  return { generatePlans, checkMidMonthRevision, exportDCAToSheet };
})();

// ── Manual test (top-level so it shows in the GAS Run dropdown) ────────────────
// Set USER_ID to a real users.id that has DCA plan items for TEST_MONTH, then run
// testExportDCAToSheet once from the IDE — it grants the Sheets/Drive scopes and
// prints the spreadsheet url. Delete/ignore after verifying.
function testExportDCAToSheet() {
  const USER_ID    = '00000000-0000-0000-0000-000000000001';   // Chelsea
  const TEST_MONTH = '2026-07';                                 // 'YYYY-MM' with plan items
  const res = DCAAgent.exportDCAToSheet(USER_ID, TEST_MONTH);
  Logger.log(JSON.stringify(res, null, 2));
}
