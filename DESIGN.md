# MyAsset+ — Design System

> **Warm cream, light-theme-only.** Redesigned 2026-07-08. There is no dark mode — this warm cream palette *is* the theme. The old blue/indigo system and the `html.dark` toggle were removed.

All tokens live in `:root` in `index.html`. The user-facing palette tokens are the source of truth; a set of legacy aliases (`--surface`, `--text-muted`, `--success`, …) map onto them so existing rules keep working.

## Color tokens

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#f6e9cf` | Warm cream — page backgrounds, sticky top bars |
| `--primary` | `#558467` | Sage green — buttons, CTAs, active tab/nav, links, positive P/L |
| `--accent` | `#b8684f` | Terracotta — highlights, badges, alerts, negative P/L |
| `--text` | `#1a1a1a` | Near-black — body text |
| `--text-inv` | `#ffffff` | White text on `--primary`/dark backgrounds |
| `--s1` | `#eee0c5` | Slightly darker cream — card surfaces |
| `--s2` | `#e5d4b0` | Card interiors, input backgrounds |
| `--border` | `rgba(85,132,103,0.2)` | Green-tinted hairline border |
| `--g` | `#558467` | Positive P/L (= `--primary`) |
| `--r` | `#b8684f` | Negative P/L (= `--accent`) |
| `--muted` | `#7a6e5f` | Warm gray — secondary/label text |

### Supporting chart neutrals (not `:root` tokens)
Used only in Chart.js datasets for a warm categorical palette:
`#c9922e` muted gold · `#6b8cae` dusty blue · `#d9b382` warm tan · `#8a9a5b` olive · `#a0785a` brown · `#c8794f` clay.

### Legacy aliases (kept so old CSS/inline styles resolve)
`--surface → --s1` · `--surface2 → --s2` · `--text-muted → --muted` · `--success → --g` · `--danger → --r` · `--warning → #c9922e` (muted gold) · `--orange → #b8684f`.

> The old `--accent`/`--accent2` (blue/purple) were renamed at the call sites: every `var(--accent)` → `var(--primary)` (the action color), and the single `var(--accent2)` → `var(--accent)` (terracotta).

## Font stack

```css
--font: 'IBM Plex Sans Thai','Noto Sans Thai',
        -apple-system, BlinkMacSystemFont, 'SF Pro Display',
        'Helvetica Neue', Arial, sans-serif;
```

Loaded from Google Fonts (`IBM Plex Sans Thai` 300–700 + `Noto Sans Thai` 400–700). Applied globally on `body`, inputs, and everywhere via `font-family: var(--font)`.

**Justification:** the app is bilingual Thai/English. `IBM Plex Sans Thai` gives a modern, even-weight Thai face with matching Latin metrics and true weight range (300–700) for hierarchy; `Noto Sans Thai` is the fallback for full glyph coverage. System faces (`-apple-system` → `SF Pro`) follow so native iOS/macOS rendering is used when a webfont hasn't loaded. The previous display faces (Syne for tickers, Instrument Sans for body, and the removed JetBrains Mono) were consolidated into this one stack for consistency across Thai + Latin + tabular numbers.

## Component color mapping

| Component | Mapping |
|---|---|
| **Page background** | `--bg` (`#f6e9cf`) |
| **Cards** | `--s1` background, `--border` border |
| **Inputs / selects / textareas** | `--s2` background, `--border` border, `--primary` on focus |
| **Buttons (primary/CTA)** | `--primary` background, `--text-inv` (white) text |
| **Active tab / nav item** | `--primary` text/fill with a subtle `rgba(85,132,103,.1)` primary tint background |
| **Inactive nav / tabs** | `--muted` |
| **Login: selected user, Google button** | selected user-btn → `--primary` border + sage tint; Google button keeps its white brand surface |
| **Badges — positive sentiment** (BUY, Onshore, AAA) | sage `--primary` on sage tint |
| **Badges — negative/alert** (SELL, Offshore, low rating, overdue) | terracotta `--accent` on terracotta tint |
| **Badges — neutral/gold** (TRIM, SSF, warnings) | muted gold `#c9922e` / `--muted` |
| **P/L positive** | `--primary` / `--g` (sage) |
| **P/L negative** | `--accent` / `--r` (terracotta) |

## Charts (Chart.js)

- **Donut slices** — warm categorical palette (`PORTFOLIO_COLORS`): sage, terracotta, muted gold, dusty blue, warm tan, olive, brown, clay. Home donut categories: US Portfolio = sage, Cash = dusty blue, Gold = muted gold, Mutual Fund = terracotta, Bonds = olive, Crypto = brown, Private = warm gray.
- **Donut center text** — value `#1a1a1a`, P/L sage/terracotta.
- **Benchmark lines** — NASDAQ = muted gold `#c9922e`, S&P 500 = dusty blue `#6b8cae`, Portfolio = sage `#558467`.
- **Technicals gauge** — terracotta → sage spectrum (Strong Sell → Strong Buy).
- **Bond maturity buckets** — `< 90d` terracotta, `90d–1yr` gold, `1–3yr` warm tan, `> 3yr` sage.
- **Axis grid / ticks** — `rgba(85,132,103,.14)` grid, `#7a6e5f` ticks.

## Removed

- `html.dark` theme block + all `html.dark …` overrides (inert), the header 🌙 toggle button, and the Settings → Appearance card.
- `toggleTheme()`/`_syncThemeUI()` are now no-ops; `initTheme()` only ensures the `dark` class is absent.
- Syne, Instrument Sans, JetBrains Mono font loads.
