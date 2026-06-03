# GAS Script Properties Setup

In the Apps Script IDE: **Project Settings → Script Properties → Add property**

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://zchwqmykjjjtoaymuvwx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | *(service_role key from Supabase Dashboard → Settings → API → service_role)* |
| `CLAUDE_API_KEY` | *(your Anthropic API key)* |
| `TELEGRAM_BOT_TOKEN` | *(your Telegram bot token)* |
| `NEWSAPI_KEY` | *(your NewsAPI.org key — add when ready)* |

> **Important:** The `SUPABASE_SERVICE_KEY` is the `service_role` secret key, NOT the anon/publishable key.
> Get it from: Supabase Dashboard → Your Project → Settings → API → service_role → Reveal.
> This key bypasses RLS and is only used server-side in GAS — never put it in index.html.

## After setting properties

1. Open `Code.gs`
2. Run `setupTriggers()` once to activate all scheduled triggers
3. Run `DataAgent.fetchAll()` manually to verify data flows into Supabase
