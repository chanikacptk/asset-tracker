/**
 * AnalystAgent.gs — Claude API portfolio analysis
 * Produces BUY/SELL/HOLD/TRIM signals + support/resistance levels per ticker.
 */

const AnalystAgent = (() => {

  function reviewGrowthPortfolios() {
    _reviewByType('growth');
  }

  function reviewDividendAndETF() {
    _reviewByType('dividend');
    _reviewByType('etf');
  }

  // Analyze every portfolio regardless of type — used by daily trigger
  function reviewAllPortfolios() {
    Logger.log('[AnalystAgent] Reviewing ALL portfolios');
    const portfolios = supabaseRequest('GET',
      'portfolios?select=id,user_id,name,type,dca_budget_usd');
    if (!portfolios || portfolios.length === 0) return;
    portfolios.forEach(portfolio => {
      try {
        _analyzePortfolio(portfolio);
      } catch (e) {
        Logger.log(`[AnalystAgent] Error analyzing ${portfolio.name}: ${e.message}`);
      }
    });
  }

  function reviewPortfolioById(portfolioId) {
    const portfolios = supabaseRequest('GET',
      `portfolios?id=eq.${portfolioId}&select=id,user_id,name,type,dca_budget_usd`);
    if (!portfolios || portfolios.length === 0) return;
    _analyzePortfolio(portfolios[0]);
  }

  // ── Core review flow ────────────────────────────────────────────────────────

  function _reviewByType(portfolioType) {
    Logger.log(`[AnalystAgent] Reviewing ${portfolioType} portfolios`);

    const portfolios = supabaseRequest('GET',
      `portfolios?type=eq.${portfolioType}&select=id,user_id,name,dca_budget_usd`);
    if (!portfolios || portfolios.length === 0) return;

    portfolios.forEach(portfolio => {
      try {
        _analyzePortfolio(portfolio);
      } catch (e) {
        Logger.log(`[AnalystAgent] Error analyzing ${portfolio.name}: ${e.message}`);
      }
    });
  }

  function _analyzePortfolio(portfolio) {
    const holdings = supabaseRequest('GET',
      `holdings?portfolio_id=eq.${portfolio.id}&select=ticker,target_pct,shares,avg_cost_usd`);
    if (!holdings || holdings.length === 0) return;

    // Get current prices
    const tickers = holdings.map(h => h.ticker);
    const prices = _getLatestPrices(tickers);

    // Get benchmark performance
    const sp500Change = _getBenchmarkChange('SP500');
    const usdThb = _getLatestUsdThb();

    // Get recent news headlines (last 7 days)
    const newsHeadlines = _getRecentNews(tickers, 7);

    // Calculate current portfolio weights
    const totalValue = holdings.reduce((sum, h) => {
      return sum + h.shares * (prices[h.ticker] || h.avg_cost_usd);
    }, 0);

    const holdingsContext = holdings.map(h => {
      const currentPrice = prices[h.ticker] || 0;
      const currentValue = h.shares * currentPrice;
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      const gainLoss = h.avg_cost_usd > 0
        ? ((currentPrice - h.avg_cost_usd) / h.avg_cost_usd) * 100
        : 0;
      return {
        ticker: h.ticker,
        target_pct: h.target_pct,
        current_pct: parseFloat(currentPct.toFixed(2)),
        gap_pct: h.target_pct ? parseFloat((h.target_pct - currentPct).toFixed(2)) : null,
        shares: h.shares,
        avg_cost: h.avg_cost_usd,
        current_price: currentPrice,
        gain_loss_pct: parseFloat(gainLoss.toFixed(2))
      };
    });

    const prompt = _buildAnalysisPrompt(holdingsContext, sp500Change, usdThb, newsHeadlines);
    const analyses = _callClaude(prompt);

    if (!analyses) return;

    // Store results
    analyses.forEach(analysis => {
      supabaseRequest('POST', 'ai_analyses', {
        ticker: analysis.ticker,
        portfolio_id: portfolio.id,
        signal: analysis.signal,
        reasoning: analysis.reasoning,
        support_level: analysis.support,
        resistance_level: analysis.resistance,
        created_at: new Date().toISOString()
      });

      if (analysis.support || analysis.resistance) {
        supabaseRequest('POST', 'sr_levels', {
          ticker: analysis.ticker,
          support: analysis.support,
          resistance: analysis.resistance,
          timeframe: 'weekly',
          created_at: new Date().toISOString()
        });
      }
    });

    Logger.log(`[AnalystAgent] Stored ${analyses.length} analyses for portfolio ${portfolio.name}`);
  }

  // ── Prompt builder ──────────────────────────────────────────────────────────

  function _buildAnalysisPrompt(holdings, sp500Change, usdThb, news) {
    const holdingsJson = JSON.stringify(holdings, null, 2);
    const newsText = news.length > 0
      ? news.map(n => `- [${n.ticker}] ${n.source_name}: ${n.title}`).join('\n')
      : 'No recent significant news.';

    return `You are a professional portfolio analyst. Analyze the following US stock portfolio and provide a signal for each holding.

PORTFOLIO HOLDINGS:
${holdingsJson}

MARKET CONTEXT:
- S&P 500 recent change: ${sp500Change !== null ? sp500Change.toFixed(2) + '%' : 'unavailable'}
- USD/THB rate: ${usdThb || 'unavailable'}

RECENT NEWS (last 7 days):
${newsText}

For each ticker, provide your analysis. Return ONLY a valid JSON array with this exact structure:
[
  {
    "ticker": "GOOGL",
    "signal": "BUY",
    "reasoning": "2-3 sentence reasoning referencing current allocation vs target, price action, and any relevant news",
    "support": 150.00,
    "resistance": 175.00
  }
]

Signal rules:
- BUY: significantly underweight vs target AND fundamentals/momentum positive
- TRIM: significantly overweight vs target OR momentum weakening
- HOLD: near target weight, no strong directional signal
- SELL: fundamental deterioration or major negative catalyst

Be concise but specific. Never fabricate news. Only reference news from the context provided.`;
  }

  // ── Claude API call ─────────────────────────────────────────────────────────

  function _callClaude(prompt) {
    const url = 'https://api.anthropic.com/v1/messages';
    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'You are a portfolio analyst. Always respond with valid JSON only, no markdown code blocks.',
      messages: [{ role: 'user', content: prompt }]
    };

    const options = {
      method: 'POST',
      headers: {
        'x-api-key': Config.CLAUDE_API_KEY(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    if (resp.getResponseCode() !== 200) {
      Logger.log(`[AnalystAgent] Claude API error: ${resp.getContentText()}`);
      return null;
    }

    const body = JSON.parse(resp.getContentText());
    const text = body.content?.[0]?.text;
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (e) {
      // Try to extract JSON array from response if Claude added any surrounding text
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
      Logger.log('[AnalystAgent] Failed to parse Claude response: ' + text.slice(0, 200));
      return null;
    }
  }

  // ── Data helpers ────────────────────────────────────────────────────────────

  function _getLatestPrices(tickers) {
    const prices = {};
    tickers.forEach(ticker => {
      const rows = supabaseRequest('GET',
        `market_data?symbol=eq.${ticker}&order=fetched_at.desc&limit=1`);
      if (rows && rows.length > 0) {
        prices[ticker] = rows[0].price;
      }
    });
    return prices;
  }

  function _getBenchmarkChange(symbol) {
    const rows = supabaseRequest('GET',
      `market_data?symbol=eq.${symbol}&order=fetched_at.desc&limit=2`);
    if (!rows || rows.length < 2) return null;
    return ((rows[0].price - rows[1].price) / rows[1].price) * 100;
  }

  function _getLatestUsdThb() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = supabaseRequest('GET',
      `exchange_rates?from_currency=eq.USD&to_currency=eq.THB&order=date.desc&limit=1`);
    return rows && rows.length > 0 ? rows[0].rate : null;
  }

  function _getRecentNews(tickers, days) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const tickerFilter = tickers.map(t => `ticker.eq.${t}`).join(',');
    const rows = supabaseRequest('GET',
      `news_items?or=(${tickerFilter})&published_at=gte.${since}&order=published_at.desc&limit=30`);
    return rows || [];
  }

  return { reviewGrowthPortfolios, reviewDividendAndETF, reviewAllPortfolios, reviewPortfolioById };
})();
