# אינטגרציית Hermes — ממצאים והחלטת ארכיטקטורה

עודכן: 31 ביולי 2026

המסמך מתאר את החוזים שנבדקו בקוד ובהתקנה חיה, ולא הנחות מוקדמות על Hermes.

## גרסאות שנבדקו

- התקנה פעילה: Hermes Agent `0.19.0` (`2026.7.20`).
- release רשמי חדש ביותר שנמצא בטווח התאימות: `0.19.1` (`v2026.7.30`).
- טווח ה־POC: `>=0.19.0 <0.20.0`.
- מעטפת: `0.3.2`.
- Windows 11 x64, התקנת native תחת `%LOCALAPPDATA%\hermes`.

## החלטה

הפתרון הוא **Hybrid דק מעל התקנת Hermes יחידה**:

1. `business-shell` — Desktop Plugin בתוך Hermes המלא.
2. Companion קטן — Electron client שמתחבר ל־`hermes serve`.

ה־Plugin הוא המסלול בעל התחזוקה הנמוכה ביותר למסכים עסקיים מלאים, משום שהוא
משתמש ב־SDK וב־UI של Hermes. ה־Companion נדרש רק לחוויית ה־widget הקטן,
הממותג והזמין תמיד — חוויה שה־Plugin לבדו אינו יכול לספק מחוץ לחלון Hermes.

שני הממשקים משתמשים באותו Hermes Home וב־Profile `default`. אין Runtime,
Memory, Skill Engine, Scheduler, Connector או Approval Engine חלופיים.

## האם Hermes מספק UI דינמי?

כן, אך לא כפרוטוקול widgets שרירותי:

- `@hermes/plugin-sdk` מוסיף routes, sidebar, palette, panes ורכיבי UI.
- Desktop מציג באופן מובנה Streaming, Tool Calls, Clarify, Approval ו־Secrets.
- Artifacts ו־Preview מציגים HTML, SVG וקוד עשיר.

לא נמצא חוזה כללי שבו המודל שולח JSON חופשי והלקוח ממציא רכיב חדש לכל תשובה.
לכן ה־POC משתמש ברכיבי Hermes הקיימים ובאירועי ה־Gateway הרשמיים, ולא יוצר
פרוטוקול UI נוסף.

מקור: [Hermes Desktop Plugin SDK](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/desktop-plugin-sdk.md).

## התקנה והפעלה

בהתקנת Windows native:

```text
Hermes Home: %LOCALAPPDATA%\hermes
CLI:         %LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe
Plugin:      %LOCALAPPDATA%\hermes\desktop-plugins\business-shell\plugin.js
Sessions:    %LOCALAPPDATA%\hermes\sessions
Skills:      %LOCALAPPDATA%\hermes\skills
Memory:      %LOCALAPPDATA%\hermes\memories
Cron:        %LOCALAPPDATA%\hermes\cron
```

ה־bootstrapper:

- מזהה התקנה קיימת לפני הורדה.
- קורא GitHub Releases ובוחר את ה־tag החדש ביותר בטווח התאימות.
- מוריד את installer הרשמי מ־tag immutable, לא מ־`main`.
- בודק שה־Desktop Plugin SDK מכיל את הסמלים שבהם המעטפת משתמשת.
- מתקין atomically את ה־Plugin ואת `business-bootstrap`.
- אינו מוחק או מחליף את Hermes Home.

## שירות רקע

Hermes מספק:

```powershell
hermes gateway install --start-now --start-on-login
```

ב־Windows הוא משתמש ב־Scheduled Task, או ב־Startup-folder login item כאשר
נדרש fallback. ה־Gateway מפעיל ערוצי הודעות ו־Cron. בבדיקה חיה
`hermes gateway status --deep` עבר שישה probes.

ה־Companion מפעיל process פרטי של:

```text
hermes serve --host 127.0.0.1 --port <dynamic>
```

הפורט נבחר מתוך טווח פנוי, והחיבור מוגן ב־session token אקראי שמועבר רק דרך
Electron IPC מבודד. השרת אינו נחשף לרשת.

## ממשק תכנותי

### Desktop Plugin

ה־Plugin משתמש רק ב־`@hermes/plugin-sdk`:

- `host.request()` ל־JSON-RPC.
- `host.onEvent()` לזרם אירועים.
- `host.state.*` למצב live של gateway, model, profile ו־session.
- `host.navigate()`, `host.logs()` ו־`host.restartGateway()`.

המקור מודולרי תחת `hermes-plugin/business-shell/src`. Rollup יוצר
`plugin.js` יחיד, משום שזה חוזה ה־loader. React וה־SDK נשארים external.
`verify:plugin` בודק שה־artifact אינו stale ושאין imports אסורים או JSX.

### Companion

Electron main מחזיק את token ה־runtime ומתווך:

- WebSocket JSON-RPC עבור Session, Prompt ו־events.
- REST מקומי עבור health, skills, cron, messaging, updates ואבחון.
- פעולות מערכת כמו פתיחת Hermes המלא, Logs ו־OAuth בדפדפן.

ה־renderer אינו מקבל Node.js או גישה ישירה למערכת הקבצים:
`contextIsolation=true`, `sandbox=true`, `nodeIntegration=false`.

## Sessions, Streaming ו־Tool Calls

החוזים שנבדקו:

```text
session.create
session.list
session.get
prompt.submit
prompt.cancel
message.delta
message.complete
tool.start
tool.end
status.update
```

Session שנוצר ב־Companion נמצא מיד דרך `session.list` ונפתח ב־Hermes המלא עם
אותו transcript. אין מסד שיחות נוסף.

Streaming נבנה מ־`message.delta` ומסתיים ב־`message.complete`. Stop שולח
`prompt.cancel`. Tool Calls אינם מוצגים למשתמש כ־API names; שכבת presentation
ממפה אותם לטקסט כמו “בודק את היומן…”.

## Clarify ואישורים

שאלות מובנות משתמשות ב:

```text
clarify.request
clarify.respond
clarify.expire
```

ה־Companion מציג בחירה יחידה, multi-select או טקסט חופשי ומחזיר את התשובה
לאותו request/session.

אישורים משתמשים ב:

```text
approval.request
approval.respond
```

לא נבנה מנגנון אישורים מקביל. בבדיקה חיה `approvals.mode` הועבר זמנית
מ־`smart` ל־`manual`; כרטיס אישור הופיע, הפעולה נדחתה והקובץ לא נמחק.
ההגדרה הוחזרה ב־`finally` ל־`smart`.

## Profile, Memory ו־Workspace

ה־POC אינו יוצר System Prompt ענקי. `business-bootstrap` מנהל שיחה הדרגתית:

- המעטפת אוספת snapshot קטן דרך APIs רשמיים.
- הסוכן שואל רק את המידע החסר הבא.
- עובדות יציבות נשמרות דרך מנגנוני Memory/Profile של Hermes.
- תהליך עסקי חוזר נשמר כ־`business-context` Skill.
- Secrets אינם נשלחים בצ׳אט.

ה־snapshot מונע מהסוכן לבצע שוב ושוב סריקות רחבות, אך אינו מחליף את שיקול
הדעת שלו או את כלי Hermes.

## Skills ולמידה

Hermes טוען Skills מאותו Hermes Home. ה־POC הוכיח:

- `business-bootstrap` ו־Skills רשמיים זמינים לסוכן.
- יצירת Skill דרך `/api/skills`.
- ה־Skill החדש מופיע דרך ה־API וב־Hermes המלא.
- קובץ ה־Skill נשמר תחת `%LOCALAPPDATA%\hermes\skills`.

תיאור ה־routing נשמר קצר כדי לעמוד בחוזה 60 התווים של Hermes; ההוראות
המלאות נשמרות בגוף ה־Skill. אין Skill Engine נוסף.

## Providers וחיבורים

Provider setup הרשמי כולל OpenAI, Anthropic, Gemini/Google, OpenRouter
וספקים נוספים לפי ה־registry של גרסת Hermes. OpenAI Codex OAuth נבדק עם
inference אמיתי.

### Google Workspace

ה־POC מאתר את `google-workspace` דרך Skills API, ומפעיל את
`scripts/setup.py` הרשמי. `--check` החזיר:

```text
available=true
authenticated=false
```

חיבור מלא דורש `client_secret.json` של Google Cloud והסכמה של המשתמש
בדפדפן. ה־POC אינו ממציא credentials ואינו עוקף consent.

### Telegram

Telegram הוא Messaging Platform רשמי. ה־POC משתמש ב־API הרשמי להגדרה,
restart ו־test, ומסמן “מחובר” רק לאחר תשובת test תקינה.

במחשב הבדיקה הוא נשאר `configured=false`, מפני שלא סופקו Bot Token ו־allowed
user ID.

### WhatsApp

- `whatsapp_cloud` — חיבור רשמי של Meta לעסקים.
- `whatsapp` — חיבור לא רשמי מבוסס WhatsApp Web.

הממשק מציג את ההבדל במפורש ואינו מתאר את הפתרון הלא רשמי כרשמי.

## Scheduled Tasks

ה־Companion משתמש ב־Cron API הרשמי עם `profile=default`:

- list, create, pause/resume ו־delete.
- התאמת schedule תומכת גם בגרסה הישנה כמחרוזת וגם במבנה החדש
  `{display, expr}`.
- המשתמש רואה “ימים א׳–ה׳ בשעה 08:00”, לא ביטוי Cron.

ב־E2E משימה נוצרה, נמצאה דרך `/api/cron/jobs`, הושהתה ונמחקה לאחר ההוכחה.

## עדכונים

המעטפת משתמשת ב:

```text
/api/hermes/update/check
/api/hermes/update
/api/actions/hermes-update/status
```

לאחר update נדרש health check. ה־POC זיהה update זמין, אך לא הפעיל בכוח
update על checkout פעיל עם שינויים. Profile, Sessions, Memory ו־Skills אינם
חלק מתיקיית קוד ה־release ולכן ה־bootstrapper אינו מוחק אותם.

## אבחון ואבטחה

חבילת האבחון בנויה מ־allowlist בלבד:

```text
README.txt
diagnostics.json
```

היא כוללת גרסאות, platform, health וסטטוס רכיבים. היא אינה כוללת API keys,
tokens, raw logs, שיחות, מיילים, קבצי עסק או פרטי לקוחות. אין remote access
או backdoor.

## הפצה ותאימות

המתקין המלא `0.3.2` כולל את ה־Companion ואת bootstrap payload. מתקין הרשת
הזעיר כולל רק bootstrap, Plugin ו־Skill; Hermes עצמו יורד מה־release הרשמי.

עמידות לשינויים נשענת על:

- טווח גרסאות מפורש, ולא “latest” עיוור.
- בדיקת SDK בזמן build והתקנה.
- adapter מרכזי לצורות Session, Cron ו־Messaging.
- API source-of-truth במקום local UI flags.
- Plugin generated עם stale-artifact gate.
- contract tests ו־E2E מול Hermes חי.

שינוי breaking ב־Hermes `0.20+` דורש העלאת טווח רק לאחר בדיקת חוזה. זו
הגנה מכוונת, לא הבטחה בלתי אפשרית ש־API עתידי תמיד יהיה תואם.

## תוצאות קבלה — 31 ביולי 2026

- `17/17` בדיקות עברו.
- Plugin contract, bootstrap resolver ו־TypeScript/Vite build עברו.
- `npm audit --omit=dev` החזיר `0` חולשות; Electron שודרג ל־`43.2.0`.
- נשארו 16 advisories מסוג high בתלויות כלי האריזה של electron-builder;
  הן אינן ב־production dependency tree, ול־npm אין כרגע מסלול תיקון שאינו
  downgrade לגרסה ישנה ופגיעה יותר.
- `clarify.request/respond` עבר גם ברמת RPC וגם ב־UI.
- Streaming, Stop, Session משותף ואישור פעולה עברו.
- Skill ו־Scheduled Task עברו מול APIs הרשמיים.
- diagnostics ZIP עבר בדיקת allowlist.
- המתקין המלא והזעיר הותקנו עם exit code `0`.
- EXE `0.3.2`, קיצורי Desktop/Start Menu ואייקון המוצר אומתו.
- Google ו־Telegram זמינים אך לא מחוברים ללא credentials של המשתמש.
- build ה־POC אינו חתום; release מסחרי דורש certificate וחתימת קוד.
