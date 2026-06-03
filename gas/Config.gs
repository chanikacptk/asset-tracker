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

    /** Supabase REST headers for service-role requests */
    supabaseHeaders() {
      return {
        'apikey': this.SUPABASE_SERVICE_KEY(),
        'Authorization': `Bearer ${this.SUPABASE_SERVICE_KEY()}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };
    }
  };
})();
