// Asset logos — source of truth, mirrored inline in index.html as `ASSET_LOGOS`
// (the app is a single no-build HTML file, so this module is the canonical reference
//  copy — same arrangement as src/config/banks.js).
//
// Logos downloaded from public repos, same pattern as the Thai bank logos:
//   • US stocks         → github.com/davidepalazzo/ticker-logos  (ticker_icons/<TICKER>.png)
//   • fund issuers      → github.com/davidepalazzo/ticker-logos  (issuer's own stock ticker:
//                         SCHW, JPM, IVZ, SPDR; Vanguard via the repo's VTI.png = Vanguard wordmark)
//   • crypto / gold     → github.com/nvstly/icons                (crypto_icons / forex_icons)
//
// Files are stored UPPERCASE / lowercase to match the key (GitHub Pages is case-sensitive).
// Any ticker NOT listed here falls back to a deterministic colored initials badge
// (see _assetLogoImg / _tkBadge in index.html) — missing logos never break the UI.
//
// NOTE: index.html uses RELATIVE paths (no leading slash) so they resolve under the
// GitHub Pages project subpath (/asset-tracker/). The leading-slash paths below match
// the existing banks.js convention; keep the two in sync.

// US stocks — Growth portfolio (all 12 present in ticker-logos, individual brand logos)
export const STOCK_LOGOS = {
  NVDA:  '/assets/logos/us-stocks/NVDA.png',
  GOOGL: '/assets/logos/us-stocks/GOOGL.png',
  AMZN:  '/assets/logos/us-stocks/AMZN.png',
  TSLA:  '/assets/logos/us-stocks/TSLA.png',
  AAPL:  '/assets/logos/us-stocks/AAPL.png',
  NFLX:  '/assets/logos/us-stocks/NFLX.png',
  COST:  '/assets/logos/us-stocks/COST.png',
  LLY:   '/assets/logos/us-stocks/LLY.png',
  TSM:   '/assets/logos/us-stocks/TSM.png',
  BKNG:  '/assets/logos/us-stocks/BKNG.png',
  RKLB:  '/assets/logos/us-stocks/RKLB.png',
  AVGO:  '/assets/logos/us-stocks/AVGO.png',
  // Dividend / blue-chip individual stock logos
  MSFT:  '/assets/logos/us-stocks/MSFT.png',
  ABBV:  '/assets/logos/us-stocks/ABBV.png',
  KO:    '/assets/logos/us-stocks/KO.png',
  PG:    '/assets/logos/us-stocks/PG.png',
  MS:    '/assets/logos/us-stocks/MS.png',   // Morgan Stanley
  JPM:   '/assets/logos/issuers/jpmorgan.png', // JPMorgan stock → Chase brand (= JEPI/JEPQ)
  // REIT / BDC that have genuine individual logos (not generic issuer brands)
  O:     '/assets/logos/us-stocks/O.png',    // Realty Income
  MAIN:  '/assets/logos/us-stocks/MAIN.png', // Main Street Capital
};

// Fund-issuer brand logos. ticker-logos has no per-ETF artwork — every ETF logo in the
// repo is just the issuer's brand (e.g. its "VTI.png" is the Vanguard wordmark, "SCHD.png"
// the Charles Schwab logo, "JEPI.png" the Chase octagon). So we map ETFs to one consistent
// issuer logo each. Sources: vanguard = repo VTI.png; schwab = SCHW; jpmorgan = JPM (Chase);
// invesco = IVZ; spdr = SPDR (State Street).
export const ISSUER_LOGOS = {
  vanguard:  '/assets/logos/issuers/vanguard.png',
  schwab:    '/assets/logos/issuers/schwab.png',
  jpmorgan:  '/assets/logos/issuers/jpmorgan.png',
  invesco:   '/assets/logos/issuers/invesco.png',
  blackrock: '/assets/logos/issuers/blackrock.png', // iShares ETFs (SGOV)
  spdr:      '/assets/logos/issuers/spdr.png', // staged — no current holding maps here (GLD = gold icon)
};

// ETF ticker → issuer logo.
export const ETF_LOGOS = {
  // Vanguard
  VTI:  ISSUER_LOGOS.vanguard, VOO: ISSUER_LOGOS.vanguard, VT:  ISSUER_LOGOS.vanguard,
  VXUS: ISSUER_LOGOS.vanguard, BND: ISSUER_LOGOS.vanguard, VHT: ISSUER_LOGOS.vanguard,
  VNQ:  ISSUER_LOGOS.vanguard, VPU: ISSUER_LOGOS.vanguard,
  // Charles Schwab
  SCHD: ISSUER_LOGOS.schwab,   SCHG: ISSUER_LOGOS.schwab,
  // JPMorgan
  JEPI: ISSUER_LOGOS.jpmorgan, JEPQ: ISSUER_LOGOS.jpmorgan,
  // Invesco — NOTE: SPHD is an Invesco fund (commonly mis-grouped under SPDR/State Street).
  QQQ:  ISSUER_LOGOS.invesco,  SPHD: ISSUER_LOGOS.invesco,
  // iShares / BlackRock
  SGOV: ISSUER_LOGOS.blackrock,
  // GLD (SPDR Gold Shares) is intentionally kept as the gold commodity icon (see MISC_LOGOS).
};

// Multi-asset icons (crypto + commodities) + a generic fund icon.
export const MISC_LOGOS = {
  BTC:  '/assets/logos/misc/BTC.png',
  ETH:  '/assets/logos/misc/ETH.png',
  XAU:  '/assets/logos/misc/XAU.png',   // gold spot
  GLD:  '/assets/logos/misc/XAU.png',   // SPDR Gold Shares ETF → gold icon
  FUND: '/assets/logos/misc/fund.svg',  // generic — Thai mutual funds have no per-fund logo
};

// Flattened ticker → path map (what index.html mirrors as ASSET_LOGOS).
export const ASSET_LOGOS = { ...STOCK_LOGOS, ...ETF_LOGOS, ...MISC_LOGOS };
