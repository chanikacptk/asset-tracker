# Skill: Deploy Google Apps Script

Steps for updating and redeploying the GAS backend after editing `.gs` files in this repo.

---

## Context

GAS files (`gas/*.gs`) are **not auto-deployed** from git. They live in the Apps Script IDE at `script.google.com`. After editing locally, you must copy-paste the changed files into the IDE and redeploy the web app.

---

## When you only changed logic (no new Script Properties)

1. Open [script.google.com](https://script.google.com) and find the **Smart Me** project.
2. For each changed `.gs` file, click its tab in the IDE and replace the content.
3. Save (Cmd+S).
4. **Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy.**
   - Description: what changed (e.g., "Fix gold price chain")
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the new web app URL if it changed and update it in the app Settings page (saved to `app_config.gas_web_app_url`).

> The web app URL stays the same if you edit an existing deployment. It only changes if you create a new deployment instead of editing the current one.

---

## When you added new Script Properties

New env vars (API keys, tokens) must be added in the IDE before running:

1. **Project Settings (gear icon) → Script properties → Add row**.
2. Enter the key name exactly as used in `Config.gs` (e.g., `NEWSAPI_KEY`).
3. Save.

See `gas/ScriptProperties.md` for the full list of required properties.

---

## When you added or changed triggers

Do **not** re-run `setupTriggers()` blindly — it creates duplicate triggers.

1. Check existing triggers: **Triggers (clock icon)** in the IDE left sidebar.
2. If the trigger you need already exists, no action needed.
3. If it's missing or wrong, delete the old one and run `setupTriggers()` from the IDE (select the function → Run).

Expected triggers after setup:
| Function | Type | Schedule |
|---|---|---|
| `onDailyTrigger` | Time-driven | Day timer, 8–9 AM |
| `onRealtimeTrigger` | Time-driven | Every 5 minutes |

---

## After deploying — verify

1. In the app, go to **Settings → Refresh Market Data**. It calls GAS `fetchData`.
2. Check **View → Executions** in the GAS IDE. The most recent run should show `[DataAgent] fetchAll complete` with no errors.
3. If you changed `doGet` routing (new actions), test by calling the URL directly:
   ```
   https://<your-gas-url>?action=fetchData
   ```
   Should return `{"ok":true,"action":"fetchData"}`.

---

## Files and their roles

| File | Purpose | Change frequency |
|---|---|---|
| `Code.gs` | `doGet` router + trigger handlers | When adding new actions |
| `Config.gs` | Script Properties wrapper | When adding new secrets |
| `DataAgent.gs` | Market data: Yahoo, Stooq, AIMC, CoinGecko | Most common edits |
| `AnalystAgent.gs` | Claude API → BUY/SELL/HOLD/TRIM signals | Signal logic changes |
| `DCAAgent.gs` | Monthly DCA plan generation | Budget/logic changes |
| `NewsAgent.gs` | NewsAPI.org fetching | Rarely |
| `NotificationAgent.gs` | Telegram alerts | When adding new alert types |

---

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `Exception: Access denied` | Web app not deployed as "Anyone" | Redeploy with correct access setting |
| `ReferenceError: X is not defined` | Copy-paste missed a file or a line | Re-copy the full file content |
| Action returns `{"ok":false,...}` | `doGet` switch doesn't have the action | Add the `else if` branch in `Code.gs` |
| Old behavior persists | Browser cached the GAS response | GAS responses aren't browser-cached; check if you deployed a new version vs. editing an old one |
| `ScriptError: Property not found` | Script Property missing | Add the property in Project Settings |
