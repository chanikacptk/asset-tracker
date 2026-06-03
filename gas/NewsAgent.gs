/**
 * NewsAgent.gs — Filtered news fetching via NewsAPI.org
 * Only stores news from approved sources. Never fabricates.
 */

const NewsAgent = (() => {

  const ALLOWED_DOMAINS = [
    'bloomberg.com', 'reuters.com', 'cnbc.com', 'wsj.com', 'ft.com',
    'bangkokpost.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
    'tradingeconomics.com', 'newsapi.org'
  ];

  const IMPACT_KEYWORDS = [
    'earnings', 'revenue', 'profit', 'beat', 'miss', 'guidance',
    'acquisition', 'merger', 'acquired', 'buyout', 'deal',
    'upgrade', 'downgrade', 'target price', 'analyst',
    'fed', 'federal reserve', 'interest rate', 'inflation', 'gdp',
    'recession', 'tariff', 'trade war', 'rate cut', 'rate hike'
  ];

  function fetchForAllHoldings() {
    const tickers = _getAllTickers();
    if (tickers.length === 0) return;

    Logger.log(`[NewsAgent] Fetching news for ${tickers.length} tickers`);
    tickers.forEach(ticker => {
      try {
        _fetchNewsForTicker(ticker);
        Utilities.sleep(300); // Respect NewsAPI rate limits
      } catch (e) {
        Logger.log(`[NewsAgent] Error for ${ticker}: ${e.message}`);
      }
    });
  }

  // ── Per-ticker fetch ────────────────────────────────────────────────────────

  function _fetchNewsForTicker(ticker) {
    const apiKey = Config.NEWSAPI_KEY();
    if (!apiKey) {
      Logger.log('[NewsAgent] NEWSAPI_KEY not set — skipping');
      return;
    }

    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&language=en&sortBy=publishedAt&from=${from}&pageSize=10&apiKey=${apiKey}`;

    const resp = _fetchJSON(url);
    if (!resp || resp.status !== 'ok') return;

    const articles = resp.articles || [];
    let stored = 0;

    articles.forEach(article => {
      if (!_isAllowedSource(article.url)) return;
      if (!_isRelevant(article.title + ' ' + (article.description || ''))) return;

      const isHighImpact = _isHighImpact(article.title + ' ' + (article.description || ''));

      try {
        supabaseRequest('POST', 'news_items', {
          ticker: ticker,
          title: article.title,
          source_name: article.source?.name || '',
          url: article.url,
          published_at: article.publishedAt,
          is_high_impact: isHighImpact,
          created_at: new Date().toISOString()
        });
        stored++;
      } catch (e) {
        // Duplicate URL → unique constraint → silently skip
      }
    });

    if (stored > 0) Logger.log(`[NewsAgent] ${ticker}: stored ${stored} articles`);
  }

  // ── Filtering ───────────────────────────────────────────────────────────────

  function _isAllowedSource(url) {
    if (!url) return false;
    return ALLOWED_DOMAINS.some(domain => url.includes(domain));
  }

  function _isRelevant(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return IMPACT_KEYWORDS.some(kw => lower.includes(kw));
  }

  function _isHighImpact(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const highImpactTerms = ['earnings', 'beat', 'miss', 'acquisition', 'merger', 'fed', 'rate cut', 'rate hike', 'recession'];
    return highImpactTerms.some(kw => lower.includes(kw));
  }

  // ── Ticker collection ───────────────────────────────────────────────────────

  function _getAllTickers() {
    const tickers = new Set();

    const holdings = supabaseRequest('GET', 'holdings?select=ticker') || [];
    holdings.forEach(h => tickers.add(h.ticker));

    const watchlist = supabaseRequest('GET', 'watchlist?select=ticker') || [];
    watchlist.forEach(w => tickers.add(w.ticker));

    return [...tickers];
  }

  function _fetchJSON(url) {
    try {
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) return null;
      return JSON.parse(resp.getContentText());
    } catch (e) {
      Logger.log(`[NewsAgent] fetchJSON error: ${e.message}`);
      return null;
    }
  }

  return { fetchForAllHoldings };
})();
