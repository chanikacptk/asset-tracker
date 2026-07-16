/**
 * Config.gs — Script Properties wrapper
 * Set all values in: Apps Script IDE → Project Settings → Script Properties
 *
 * Required properties:
 *   SUPABASE_URL         - e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY - service_role key (bypasses RLS for GAS writes)
 *   CLAUDE_API_KEY       - Anthropic API key
 *   TELEGRAM_BOT_TOKEN   - single bot token (users identified by chat_id)
 *   NEWSAPI_KEY          - NewsAPI.org key
 */

const Config = (() => {
  const props = PropertiesService.getScriptProperties();

  return {
    SUPABASE_URL:         () => props.getProperty('SUPABASE_URL'),
    SUPABASE_SERVICE_KEY: () => props.getProperty('SUPABASE_SERVICE_KEY'),
    CLAUDE_API_KEY:       () => props.getProperty('CLAUDE_API_KEY'),
    TELEGRAM_BOT_TOKEN:   () => props.getProperty('TELEGRAM_BOT_TOKEN'),
    NEWSAPI_KEY:          () => props.getProperty('NEWSAPI_KEY'),
    SEC_API_KEY:          () => props.getProperty('SEC_API_KEY'),

    /** Master switch for ALL Telegram sends (news brief, reviews, alerts).
     *  Paused 2026-07-16 for cost/noise reduction — flip to `true` to re-enable
     *  every notification without touching any other code. Guarded in
     *  NotificationAgent `_send` / `_sendHtml`. */
    TELEGRAM_ENABLED:     () => false,

    /** Supabase REST headers for service-role requests.
     *  Tables live in the `asset_track` schema (migrated into the MyExp+ project),
     *  so PostgREST must be told which schema to use: Accept-Profile for reads,
     *  Content-Profile for writes. Sending both on every request is harmless
     *  (PostgREST uses the relevant one per method). */
    supabaseHeaders() {
      return {
        'apikey': this.SUPABASE_SERVICE_KEY(),
        'Authorization': `Bearer ${this.SUPABASE_SERVICE_KEY()}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'asset_track',
        'Content-Profile': 'asset_track',
        'Prefer': 'return=representation'
      };
    }
  };
})();
