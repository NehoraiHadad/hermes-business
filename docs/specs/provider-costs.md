# אפיון: עלויות ספקים, Nous Portal ומד שימוש — תכל'ס

**מסמך:** `docs/specs/provider-costs.md`
**ריפו:** `C:\projects\hermes-business-poc`
**גרסת Hermes שנבדקה:** 0.19.1 (מותקן ב-`%LOCALAPPDATA%\hermes\hermes-agent`; ה-checkout ב-`C:\projects\hermes-agent` הוא 0.17.0 ולא שימש כראיה)
**סטטוס:** מומש 2026-08-04 (פאזות 1, 2, 2ב, 3). בהמשך להכרעת משתמש נוספת:
שורת השימוש קיבלה **שכבת מכסה** ("כמה נשאר") מעל הספירה המקומית ("כמה
השתמשתי"), משתי דלתות אמיתיות — (א) פסיקת ה-pool של Hermes עצמו
(`GET /api/credentials/pool`, ‏`last_status: exhausted` = הספק החזיר 429
ו-Hermes הקפיא את האישור עד ההתחדשות; זו האמת הרשמית חוצת-הספקים), ו-(ב)
אחוז המכסה החי של Codex (פאזה 2ב, מה-probe הקיים שהורחב להחזיר
`usedPercent`/`quotaExhausted` כשדות תצוגה בלבד — שער הראיות לא השתנה).
עדיפות: exhausted &gt; אחוז Codex &gt; ספירה מקומית. הכול תצוגה בלבד.

**אילוץ-על (של המשתמש): לא מסבכים את ה-UI.** כל פאזה כאן מעשירה משטח קיים
(שורה בפאנל בריאות קיים, אופציה ב-select קיים, section באתר קיים). אף פאזה לא
מוסיפה מסך, פאנל או זרימה חדשים.

---

## 1. תשובות קצרות לשאלות החקירה

| # | שאלה | תשובה בקצרה |
|---|---|---|
| 1 | מה ברירת המחדל בחיבור ספק? | **OpenAI דרך מנוי ChatGPT (Codex, device-flow, בלי מפתח API)** — `useState('openai-codex')` ב-`ProviderModal.tsx:17` והאופציה הראשונה ב-select. אמונת המשתמש מאומתת. |
| 2 | האם רשימת הספקים מסונכרנת מ-Hermes? | **לא. ה-select מקודד קשיח** (`ProviderModal.tsx:37-43`). ה**דלת** המסונכרנת קיימת (`GET /api/providers/oauth` מאחדת אוטומטית כל ספק חדש — `web_server.py:9714-9761`) ותכל'ס **כבר קורא אותה** — אבל משתמש בתשובה רק לבדוק אם Codex מחובר (`ProviderModal.tsx:23`). ספק חדש בצד Hermes (כמו Nous) **לא** יופיע מעצמו. זה פער הליבה — ונסגר ברינדור הקטלוג לפי `flow` (§2.2, הכרעת משתמש). |
| 3 | Nous Portal דרך דלתות רשמיות? | **כן, כבר היום, כמעט באפס עבודה.** `nous` הוא ספק `device_code` באותו קטלוג ובאותם endpoints שה-Codex שלנו כבר צורך; ה-allow-list ב-IPC כבר מתיר אותו (הנתיב גנרי לכל מזהה ספק). free-tier מטופל בצד Hermes אוטומטית. ראו §2.3. |
| 4 | מנגנון שימוש/מכסה מאוחד? | **קיימת דלת מקומית מאוחדת אחת: `GET /api/analytics/usage`** — טוקנים + עלות משוערת לכל הספקים/מודלים יחד (`web_server.py:13937-13939`). היא **חשבונאות מקומית**, לא אחוז-מכסה אצל הספק. דלת "% מהמכסה" אמיתית קיימת רק ל-Codex — וכבר ממומשת אצלנו (`electron/codex-probe.cjs:50-63`). דלת מאוחדת ל"כמה נשאר לי אצל הספק" — **אין**, וזה נאמר בכנות. ראו §2.4. |
| 5 | איפה מד השימוש? | **שורה אחת בפאנל "מצב המערכת" הקיים** במסך העזרה (`SupportStatusPanel.tsx:40-48`). אפס משטחים חדשים. ראו §4. |
| 6 | section עלויות באתר? | מתווה עברי מלא ב-§5, ממוקם בין "מה צריך" ל"התקנה" ב-`site/index.html`. |

---

## 2. מצב קיים — ממצאים עם ראיות

### 2.1 מסך חיבור הספק היום (Q1)

- **הכניסה לזרימה**: onboarding מזהה `!provider_ready` ופותח את מודאל הספק —
  `src/components/onboarding/Onboarding.tsx:40-41` → `AppModalLayer.tsx:50-63`
  (`modal === 'provider'` ⇒ `<ProviderModal>`).
- **ברירת המחדל היא Codex**: `src/components/dialogs/ProviderModal.tsx:17` —
  `useState('openai-codex')`; זו גם האופציה הראשונה ב-select (שורה 38:
  "OpenAI Codex — חיבור ChatGPT").
- **OAuth/מנוי (בלי מפתח)**: רק `openai-codex`. הזרימה: `startOAuth` →
  פתיחת דפדפן עם user_code → polling → `activateProvider` →
  `recordProviderEvidence` (`CodexOAuth.tsx:55-92`). לחיבור קיים על הדיסק יש
  probe חי לא-הרסני (`useExisting`, `CodexOAuth.tsx:94-113`, נאכף ע"י
  `gateExistingCodexGrant`) — snapshot שמור לעולם אינו הוכחת שמישות.
- **מפתח API מודבק**: `openrouter` / `anthropic` / `openai` / `gemini`
  (`ProviderModal.tsx:39-42`), ממופים ל-env keys ב-
  `src/lib/hermes/core.ts:41-46` (`PROVIDER_API_KEYS`). המפתח מאומת חי לפני
  שמירה (`providers.ts:75-121`: `/api/providers/validate`, ול-Anthropic —
  probe ייעודי ב-main כי ל-Hermes אין probe עבורו).
- **חוזה המוכנות** (`shared/provider-readiness.js`): רשימת ה-env keys מקודדת
  (שורות 8-13, `API_KEY_PROVIDERS`) — אבל בדיקת ה-OAuth היא **גנרית**: כל ספק
  שמדווח `status.logged_in` נחשב הוכחה חיובית (שורה 21). כלומר התחברות Nous
  הייתה מדליקה `provider_ready` **כבר היום, בלי שינוי קוד** — רק אין למשתמש
  דרך להגיע אליה מה-UI.

### 2.2 סנכרון רשימת הספקים (Q2) — הפער המרכזי

צד Hermes 0.19.1 (כל הנתיבים תחת `%LOCALAPPDATA%\hermes\hermes-agent\hermes_cli\`):

- `web_server.py:9764-9804` — `GET /api/providers/oauth` מחזיר לכל ספק:
  `id`, `name`, `flow` (`pkce` | `device_code` | `external`), `cli_command`,
  `docs_url`, ו-`status.logged_in` חי.
- `web_server.py:9714-9761` — `_build_oauth_catalog()` הוא **איחוד**: כרטיסים
  מכווננים-ידנית (`_OAUTH_PROVIDER_CATALOG`, שורות 9501-9577: nous,
  openai-codex, qwen-oauth, minimax-oauth, xai-oauth, copilot-acp, anthropic,
  claude-code) + כל ספק accounts מקטלוג `provider_catalog()` — "so any
  OAuth/external provider added as a plugin appears automatically".

צד תכל'ס:

- `src/lib/hermes/providers.ts:123-126` — `listOAuthProviders()` קורא את הדלת
  הזו בדיוק.
- `src/components/dialogs/ProviderModal.tsx:26-31` — התשובה נטענת... ומשמשת
  **רק** ל-`oauthProviders.find(item => item.id === 'openai-codex')` (שורה 23).
  ה-select עצמו (שורות 37-43) הוא חמש אופציות קשיחות.

**מסקנה (הכרעת משתמש 2026-08-04, מחליפה את המלצת החקירה המקורית):** האמונה
"הרשימה נמשכת מ-Hermes" נכונה לגבי הדלת ולא נכונה לגבי ה-UI — וזה מה שמתקנים:
**ה-select מרונדר מהקטלוג המלא של `/api/providers/oauth`**, לא מרשימה קשיחה.
החשש המקורי ("כל ספק דורש UI שונה") התברר כמוגזם: שדה ה-`flow` שהקטלוג כבר
מחזיר ממפה כל ספק לאחת מ**שלוש** צורות UI בלבד:

| `flow` | ספקים (0.19.1) | UI |
|---|---|---|
| `device_code` | nous, openai-codex, minimax-oauth, xai-oauth | הזרימה הקיימת של Codex (קוד + פתיחת דפדפן + polling), מוכללת לפרמטר `providerId` |
| `pkce` | anthropic (כרטיס ה-API-key) | טופס קטן: פתיחת דפדפן + הדבקת קוד חוזר |
| `external` | qwen-oauth, copilot-acp, claude-code + כל ספק-plugin עתידי | כרטיס תצוגה בלבד: שם + `cli_command` + קישור `docs_url` + מצב חיבור. בלי טופס, בלי זרימה |

רוב הספקים הם `device_code` — מנוי שקופץ לדפדפן, בדיוק המסך שכבר קיים.
`external` אינו דורש UI אינטראקטיבי בכלל, וזו גם ברירת המחדל שהקטלוג נותן
לספק לא מוכר (`web_server.py:9753`) — כלומר ספק חדש בצד Hermes מקבל אוטומטית
הצגה בטוחה (כרטיס מידע) גם בלי שנכתב לו UI. `flow` לא מזוהה בצד שלנו ⇒ נופלים
ל-UI של `external` (fail-safe תצוגתי). מסלול המפתחות המודבקים
(openrouter/openai/gemini) נשאר כפי שהוא לצד רשימת הקטלוג.

### 2.3 Nous Portal (Q3) — זמין כמעט באפס עבודה

מה עושה `hermes setup --portal` (זהה ל-`hermes portal`):
`subcommands/setup.py:60-66` — "One-shot Nous Portal setup: log in via OAuth,
pick a Nous model, set Nous as the inference provider, and opt into the Tool
Gateway". `portal_cli.py:1-19` מאשר ש-`hermes portal` הוא alias לאותה זרימה,
ו-`hermes portal info` מציג auth + ניתוב Tool Gateway (`portal_cli.py:34-104`).

הדלתות ב-REST של ה-gateway:

| צורך | דלת | ראיה |
|---|---|---|
| (a) התחלת התחברות Portal | `POST /api/providers/oauth/nous/start` — `nous` הוא `device_code` בקטלוג, ומנותב ל-`_start_device_code_flow` | `web_server.py:9502-9509`, `web_server.py:10749-10784` (ולידציה מול `_OAUTH_PROVIDER_CATALOG`, שורה 10759) |
| polling | `GET /api/providers/oauth/nous/poll/{session_id}` | `web_server.py:10803` |
| (b) מצב התחברות | `GET /api/providers/oauth` ⇒ כרטיס `nous` עם `status.logged_in` (snapshot ללא refresh) | `web_server.py:9589-9600` |
| (b') מצב Portal ייעודי | `GET /api/portal` ⇒ `logged_in`, `portal_url`, `provider`, `subscription_url`, `features` | `web_server.py:3510-3550` |
| (c) מצב חינם/בתשלום | `GET /api/model/recommended-default?provider=nous` ⇒ `{provider, model, free_tier: bool\|null}` — למשתמש חינמי נבחר אוטומטית מודל חינמי | `web_server.py:6147-6203`; חלוקת המודלים לפי tier: `models.py:664-681`; זיהוי ה-tier מ-Portal `/api/oauth/account`: `models.py:832-858`, `nous_account.py:104-112` |

**נקודת אפס-עבודה קריטית:** ה-allow-list של ה-IPC כבר מתיר את כל זה. הנתיב
`^/api/providers/oauth(/sessions/SEG|/SEG/(start|poll/SEG))?$`
(`electron/ipc-guards.cjs:100`) גנרי למזהה הספק — `nous` עובר בדיוק כמו
`openai-codex`, וגם `recommended-default?provider=nous` + `/api/model/set`
מותרים (`ipc-guards.cjs:98`, מפתח query `provider` מותר בשורה 107). כלומר
**"התחבר עם חשבון Nous" אפשרי בשינוי renderer בלבד** — אפס שינוי ב-electron/,
אפס route חדש. (חריג: `GET /api/portal` **אינו** ב-allow-list — והוא גם לא
נחוץ לפאזה 3, כי `listOAuthProviders` כבר מחזיר את `logged_in` של nous.)

מה קורה כשהמסלול החינמי נגמר — הגבולות הכנים:

- ה"חינם" של Nous הוא **מודלים חינמיים** (partition לפי מחיר —
  `models.py:664-681`), לא ארנק קרדיטים מקומי שנצפה דרך ה-gateway.
- Tool Gateway (כלים מנוהלים) הוא פיצ'ר **בתשלום**; לחשבון חינמי יש inference
  בלבד (docs: `website/docs/user-guide/features/tool-gateway.md:83`, וכן
  free tool pool אופציונלי, שורה 85). מנוי שפג ⇒ הכלים נעצרים עם שגיאה שמפנה
  ל-Portal (שם, שורה 180).
- ספק ללא יתרה משלם `402` בזמן ריצה (התנהגות מאושרת בהערת המקור על
  "nous with $0 balance … keeps paying 402s" — `web_server.py:6513-6521`).
- יתרה/קרדיטים נקראים רק ישירות מול Portal (`nous_account.py` — "read-only
  entitlement/balance", `nous_billing.py:1-24`) **ואינם חשופים כ-REST של
  ה-gateway המקומי** (אין `/api/billing/*` ב-`web_server.py` — נבדק). לכן
  תכל'ס לא יציג יתרת Nous; הוא יפנה ל-Portal (`subscription_url` שכבר מוחזר
  מהדלתות).
- התנהגות מדויקת של rate-limit על מודלים חינמיים — שאלה פתוחה ל-live (ראו §7).

### 2.4 מנגנון שימוש מאוחד (Q4)

**קיים, מקומי, אחד:** `GET /api/analytics/usage?days=N` —
`web_server.py:13937-13939`, מימוש ב-`_get_usage_analytics`
(`web_server.py:13856-13932`): צבירה מ-DB הסשנים המקומי על פני **כל** הספקים
והמודלים — `daily`, `by_model` (כולל שימוש-עזר vision/compression, שורות
13889-13895), `by_task`, `totals` עם `total_input/output_tokens`,
`total_estimated_cost`, `total_actual_cost`, `total_sessions`,
`total_api_calls`. יש גם `GET /api/analytics/models` עשיר יותר עם
`billing_provider` פר-מודל (`web_server.py:13942-13967`).

מה זה **לא**: זו חשבונאות מקומית ("כמה השתמשתי"), לא מצב מכסה אצל הספק ("כמה
נשאר לי"). דלתות מצב-מכסה אצל הספק:

- **Codex — קיימת וכבר ממומשת אצלנו**: ה-probe הלא-הרסני
  `electron/codex-probe.cjs` קורא את `/usage` הרשמי של ChatGPT ומחלץ
  `rate_limit.primary_window/secondary_window.used_percent`
  (`codex-probe.cjs:50-63`); `429` = מכסה מוצתה (שורות 124-128). זה בדיוק
  הנתון ל"נוצלו X% מהמכסה" — לספק אחד, Codex.
- **Nous** — usage per-tool מוצג ב-dashboard של Portal באתר
  (`tool-gateway.md:182-184`), לא בדלת מקומית.
- **מפתחות API (OpenRouter/Anthropic/Gemini/OpenAI)** — אין דלת מכסה ב-Hermes.

**הכרעת האפיון (כמצוות השאלה — קריאה מאוחדת אחת):** מד השימוש נשען על
`/api/analytics/usage` בלבד כבסיס לכולם, בתווית כנה ("שימוש שנמדד אצלך במחשב");
אחוז-מכסה מוצג רק כשיש דלת אמיתית לכך — Codex — כתוספת מסומנת בפאזה נפרדת.
לא בונים אינטגרציית מכסה פר-ספק מעבר לזה.

### 2.5 מה שכבר עובד ואינו דורש עבודה (ZERO work)

1. **Probe מכסת Codex** — ממומש ובדוק (`electron/codex-probe.cjs`,
   `codex-probe.test.ts`); פאזה 2ב רק צורכת אותו.
2. **צנרת device-flow גנרית** — `startOAuth/pollOAuth/cancelOAuth/activateProvider`
   (`providers.ts:128-150`) ו-allow-list ה-IPC (`ipc-guards.cjs:100`) עובדים
   עבור `nous` כבר היום; אפס שינוי ב-main.
3. **מוכנות ספק אחרי התחברות Nous** — `inspectOAuth` גנרי לכל `logged_in`
   (`shared/provider-readiness.js:19-23`); שום שינוי בחוזה המוכנות.
4. **בחירת מודל חינמי אוטומטית** — `activateProvider('nous')` שלנו קורא
   `recommended-default` (`providers.ts:56-61`) ש-Hermes כבר הופך ל-free-tier
   aware (`web_server.py:6187-6200`).
5. **בצד Hermes הרשימה כבר מסונכרנת** — `_build_oauth_catalog` (union). הפער
   הוא ב-UI שלנו בלבד, ונסגר ברינדור הקטלוג לפי `flow` (§2.2, פאזה 3).

---

## 3. פאזות מימוש (מהקטנה לגדולה; כל אחת ניתנת לשילוח עצמאי)

### פאזה 1 — section "כמה זה עולה" באתר (סטטי, אפס סיכון קוד)
**קבצים:** `site/index.html` (+`site/` CSS קיים).
המתווה המלא ב-§5. מיקום: בין `#requirements` (`site/index.html:123-133`)
ל-`#install` (שורה 136), באותו ריטמוס `section`/`check-list` קיים.
**קבלה:** עברית במשלב משתמש-פשוט (register: `user-facing-copy-register`);
אפס טענות על מכסות שלא אומתו; קישורים רשמיים בלבד; RTL תקין.

### פאזה 2 — שורת שימוש בפאנל "מצב המערכת" (הקריאה המאוחדת)
**קבצים:** `electron/ipc-guards.cjs` (+route `/^\/api\/analytics\/usage$/` +
מפתח query `days` ב-`API_QUERY_KEYS`, שורה 107) + עדכון בדיקות ה-lockstep;
`src/lib/hermes/rest-usage.ts` (חדש, פונקציה אחת); `src/lib/hermes/demo-api.ts`
(fixture — כמו שקיים ל-oauth, שורות 13-30); `src/lib/health-panel.ts` (שורה
אחת); `SupportStatusPanel.tsx` (העברת הנתון); בדיקות בהתאם ל-`health.test.ts`.
**התנהגות:** ראו §4.
**קבלה:** קריאה שנכשלה ⇒ שורת "אין נתוני שימוש כרגע" במצב `warning` — לעולם לא
"0" ולעולם לא מפילה את ה-verdict הכולל ל-error (שימוש אינו רכיב חובה,
בניגוד לספק — `health-panel.ts:47-51`); demo מגיש fixture; בדיקת ipc-guards
מכסה את ה-route והמפתח החדשים.

### פאזה 2ב (אופציונלית, מסומנת Codex-בלבד) — אחוז מכסה אמיתי
**קבצים:** `src/lib/hermes-client.ts` (ה-facade כבר חושף `probeCodexGrant` —
בשימוש `CodexOAuth.tsx:101`); `health-panel.ts`/`SupportStatusPanel.tsx`.
כאשר הספק הפעיל הוא Codex וה-probe מחזיר 200 עם `used_percent`, השורה מציגה
"נוצלו X% מהמכסה"; `429` ⇒ "המכסה מוצתה כרגע"; probe לא-ישים ⇒ נסיגה לנתוני
פאזה 2. ה-probe רץ רק בכניסה למסך העזרה (לא polling — קריאת רשת חיצונית).
**קבלה:** אין טענת "% מכסה" לאף ספק שאינו Codex; כל מצבי הכשל נבדקים.

### פאזה 3 — רשימת הספקים מהקטלוג המלא + חיבור Nous
**קבצים:** `src/components/dialogs/ProviderModal.tsx` — ה-select ניזון
מ-`listOAuthProviders()` (שכבר נקרא שם) במקום חמש האופציות הקשיחות, ממופה לפי
`flow` לשלוש צורות ה-UI של §2.2; הכללת `CodexOAuth` לרכיב device-flow פרמטרי
(`DeviceFlowOAuth` עם `providerId`, אותו קובץ/תיקייה — הזרימה ב-
`CodexOAuth.tsx:55-92` כבר גנרית פרט למחרוזות); רכיב `pkce` קטן (פתיחת דפדפן +
הדבקת קוד) לכרטיס Anthropic; כרטיס `external` תצוגתי (שם, `cli_command`
להעתקה, `docs_url`, מצב חיבור); מסלול המפתחות המודבקים הקיים נשאר לצדם;
`providers.ts` — החזרת `free_tier` מ-`activateProvider` (היום הוא נזרק,
שורות 68-72). *(במימוש: הערת המסלול החינמי מוצגת כטקסט קבוע לפני החיבור —
המודאל נסגר מיד עם ההצלחה, אז הצגה אחריו הייתה דורשת משטח חדש; `free_tier`
מוחזר מה-API לשימוש עתידי.)*
**כשל טעינת הקטלוג:** אם `listOAuthProviders()` נכשל, המודאל נסוג לרשימה
הקשיחה הנוכחית (fallback סטטי) — המשתמש לעולם לא נשאר בלי דרך להתחבר.
**חוזה ראיות (evidence):** רק אישור device-flow טרי טובע ראיית ספק (העיקרון
הקיים — האישור הוא round-trip חי). מסלול "השתמש בחיבור הקיים" **לא** מוצע
ל-Nous בפאזה זו: `logged_in` של nous הוא snapshot ללא refresh
(`web_server.py:9589-9592`) ואין לנו probe חי לא-הרסני עבורו (המקבילה של
`codex-probe` — לא קיימת). fail-closed: בלי הוכחה — בלי ראייה.
**קבלה:** זרימה מלאה מול gateway מבודד (לא הפרופיל החי); demo fixture ל-
`/api/providers/oauth` המלא (כל שלושת סוגי ה-`flow`) ול-`oauth/nous/start|poll`;
בדיקה ש-`flow` לא מוכר מרונדר ככרטיס `external` (fail-safe); בדיקת ה-fallback
הסטטי כשהקטלוג לא נטען; עברית פשוטה בכל המחרוזות.

**מחוץ לפאזות (נדחה במפורש):** הצגת יתרת Nous (אין דלת מקומית — §2.3).

---

## 4. מד השימוש — עיצוב מדויק (Q5)

**מיקום:** שורת `CheckRow` אחת נוספת בפאנל "מצב המערכת" הקיים במסך העזרה —
`SupportStatusPanel.tsx:45-47` מרנדר את שורות `buildSystemHealth`
(`health-panel.ts:52`), והפאנל כבר יושב במסך העזרה (`SupportScreen.tsx:67`).
גודל: שורה אחת, אותו קומפוננט `CheckRow` (אייקון + תווית + ערך). **למה זה לא
מוסיף עומס:** הפאנל הוא כבר רשימת שורות מצב (ספק, חיבורים, משימות); שורה
תשיעית באותה שפה חזותית אינה משטח חדש ואינה דורשת ניווט חדש.

**מצבים (fail-closed מלא):**

| מצב | ערך מוצג | state |
|---|---|---|
| קריאה הצליחה, יש שימוש | "כ-N פניות ב-30 הימים האחרונים" (מ-`totals.total_api_calls`; ניסוח פשוט, בלי "טוקנים") | `ok` |
| קריאה הצליחה, אפס פניות **וגם** אפס סשנים | "עדיין לא נעשה שימוש" (אפס אמיתי — הקריאה הצליחה) | `ok` |
| קריאה נכשלה / endpoint חסר (Hermes ישן) | "אין נתוני שימוש כרגע" | `warning` |
| runtime לא רץ | השורה לא מוצגת (אין ממה לקרוא; שורת ה-runtime כבר `error`) | — |
| demo | ערך fixture מוצהר | `ok` |
| ה-pool של Hermes מדווח שכל האישורים של הספק הפעיל `exhausted` | "המכסה נוצלה כרגע — תתחדש אוטומטית" (גובר על כל השאר) | `warning` |
| Codex פעיל + probe 200 עם אחוז | "נוצלו X% מהמכסה" | `ok` / `warning` כש-X≥90 |
| Codex probe מחזיר 429 או חלון בשימוש מלא | "המכסה נוצלה כרגע — תתחדש אוטומטית" | `warning` |
| זיהוי הספק הפעיל נכשל / אף דלת מכסה לא ענתה | נסיגה לספירה המקומית (השורות למעלה) | — |

**כלל-על (הכרעת משתמש 2026-08-04): תצוגה בלבד, לעולם לא חוסמת.** נתון השימוש
אינו משתתף בשום שער — לא במוכנות ספק, לא ב-verdict הבריאות הכולל, לא בשום
disable של כפתור או זרימה. גם אם החישוב שגוי, הקריאה נכשלת או הערך נראה
בלתי-סביר — שום פעולה של המשתמש לא נחסמת בגללו. (בניגוד לשורת הספק, שהיא כן
רכיב חובה.)

**תקופות:** אותו endpoint עם `days` שונה — ברירת המחדל "30 הימים האחרונים",
עם אפשרות זולה להציג גם "היום" (`days=1`) באותה שורה ("היום: N · החודש: M").
אין צורך ב-endpoint נוסף ואין state חדש.

כללי ברזל: כשל-קריאה לעולם אינו מרונדר כ-"0%" או "עדיין לא נעשה שימוש"
(ההבחנה: אפס מוצג רק אחרי קריאה שהצליחה); "% מכסה" לעולם לא נטען מנתוני
`/api/analytics/usage` המקומיים — רק מדלת מכסה אמיתית (Codex); אין polling —
הנתון נקרא עם רענון מסך העזרה הקיים. עלות משוערת (`total_estimated_cost`)
**לא** מוצגת בשורה: למשתמשי מנוי (Codex/Nous) היא מטעה — הם משלמים מחיר קבוע.

---

## 5. section "כמה זה עולה" באתר (Q6) — מתווה

מיקום: `site/index.html`, section חדש `id="cost"` בין `#requirements`
(שורות 123-133) ל-`#install` (שורה 136), class בהתאם לריטמוס הקיים.

כותרת: **"כמה זה עולה"**

1. **פסקת פתיחה:** תכל'ס עצמו חינם וקוד פתוח. התשלום היחיד הוא לספק הבינה
   המלאכותית שבוחרים — והבחירה בידיים שלכם.
2. **המסלול המומלץ (ברירת המחדל):** מנוי ChatGPT (בסביבות $20 לחודש) —
   מתחברים בלחיצה מתוך האפליקציה, בלי מפתחות ובלי הפתעות בחיוב: מחיר קבוע,
   והמכסה נדיבה לשימוש עסקי יומיומי. (בלי לנקוב במספרי מכסה — לא אומתו; ראו §7.)
3. **מסלולים חינמיים להתחלה:**
   - **חשבון Nous** — התחברות חינמית עם גישה למודלים חינמיים
     (מאומת: free tier ב-`web_server.py:6187-6200`; Portal:
     `portal.nousresearch.com`). שדרוג בתשלום פותח מודלים נוספים וכלים
     מנוהלים. *(את הסעיף הזה מפרסמים רק יחד עם או אחרי פאזה 3 — לא מפרסמים
     מסלול שאי-אפשר להשלים מה-UI.)*
   - **Google Gemini** — מפתח API עם מדרגת חינם של Google.
   - **OpenRouter** — יש מודלים בחינם (מסומנים `:free`; דוגמה רשמית בתיעוד
     Hermes — `configuring-models.md:151`).
4. **פסקת בחירה מודעת (לא אזהרה):** "חשוב לדעת: מה שתכתבו לתכל'ס — כולל
   תוכן עסקי — נשלח לעיבוד אצל הספק שבחרתם, לפי תנאי השימוש שלו. כל השאר
   נשאר אצלכם במחשב. חלק מהספקים פועלים מחו"ל, תחת חוקים שונים משלנו — לרוב
   העסקים זה בסדר גמור, ורק כדאי לבחור ספק שנוח לכם לסמוך עליו, כמו כל ספק
   שירות אחר לעסק." (משלב: אנושי, לא משפטי; ללא אצבע מאשימה כלפי אף מדינה;
   עקבי עם משפט ה"נתונים אצלך" הקיים ב-`#privacy`, שורות 110-120.)

---

## 6. לא-מטרות (Non-goals)

- **לא** בונים אינטגרציית ספק משלנו (אין SDK-ים של ספקים בתכל'ס; רק דלתות
  Hermes הרשמיות + ה-probe הקיים של Codex).
- **לא** אוספים טלמטריה/נתוני שימוש מהמשתמשים — כל הנתונים נקראים מקומית
  ומוצגים מקומית (עקבי עם "גם באתר אין מעקב", `site/index.html:115`).
- **לא** מעצבים מחדש UI: אין מסך חדש, אין פאנל חדש, אין גרף. שורה אחת,
  אופציה אחת ב-select, section אחד באתר.
- **לא** מממשים צד-כתיבה של Billing (קניית קרדיטים / החלפת תוכנית —
  `nous_billing.py` הוא כלי CLI/TUI של Hermes; לא דלת שלנו).
- **לא** גוזרים "% מכסה" מנתונים מקומיים ולא ממציאים מספרי מכסות בשיווק.
- **לא** חוסמים שום פעולת משתמש על סמך נתוני שימוש — תצוגה בלבד (§4).
- **לא** נוגעים בפרופיל ה-Hermes החי בבדיקות (בידוד כמקובל בריפו).

---

## 7. שאלות פתוחות — דורשות Hermes חי ומחובר (ללא כתיבה לפרופיל החי)

1. **צורת `/api/analytics/usage` בפועל**: האם `estimated_cost_usd` מאוכלס
   עבור סשנים של ספקי מנוי (Codex/Nous) או נשאר 0? משפיע רק על ניסוח, לא על
   העיצוב (העלות ממילא לא מוצגת בשורה).
2. **חלונות המכסה של Codex**: `primary_window`/`secondary_window` — מהו טווח
   הזמן בפועל (שבועי? חודשי?). עד אימות, הקופי אומר "מהמכסה" בלי לנקוב
   בתקופה. (ה-probe שלנו כבר מטפל בשני החלונות — `codex-probe.cjs:55-61`.)
3. **round-trip חי של device-flow ל-nous** מול gateway מבודד: אישור שהזרימה
   זהה ל-Codex כולל payload ה-poll.
4. **התנהגות מיצוי בפועל במסלול Nous החינמי**: rate-limit על מודלים חינמיים —
   איזה סטטוס/הודעה חוזרים בצ'אט (402? 429?), כדי שהקופי בפאזה 3 יהיה מדויק.
5. **`GET /api/portal` במצב לא-מחובר** — אימות הצורה (צפוי `logged_in:false`);
   רלוונטי רק אם נרצה בעתיד שורת מצב Portal (לא בסקופ הנוכחי).
