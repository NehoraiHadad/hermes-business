# אינטגרציית Hermes — ממצאים והחלטת ארכיטקטורה

עודכן: 1 באוגוסט 2026

המסמך מתאר את החוזים שנבדקו בקוד ובהתקנה חיה, ולא הנחות מוקדמות על Hermes.

## גרסאות שנבדקו

- התקנה פעילה: Hermes Agent `0.19.1` (`2026.7.30`).
- release רשמי חדש ביותר שנמצא בטווח התאימות: `0.19.1` (`v2026.7.30`).
- טווח התאימות הנתמך: `>=0.19.0 <0.20.0`.
- מעטפת: `0.4.0-alpha.1`.
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

לפני פעולת חיבור שדורשת restart, המעטפת מפעילה `hermes:gateway:ensure` דרך
Electron main. תהליכי CLI מורצים עם stdin סגור, כדי ששאלת elevation של Hermes
לא תיתקע כ־prompt בלתי נראה; Hermes יכול לבחור בברירת המחדל הבטוחה וב־fallback
הלא־ניהולי שלו. המנגנון הוכח לאחר עצירה מכוונת של ה־Gateway וחיבור Telegram
מחדש מהבינארי המותקן.

ה־Companion מפעיל process פרטי של:

```text
hermes serve --host 127.0.0.1 --port <dynamic>
```

הפורט נבחר מתוך טווח פנוי, והחיבור מוגן ב־session token אקראי שמועבר רק דרך
Electron IPC מבודד. השרת אינו נחשף לרשת.

בקשות ה־REST של Electron main נגד `hermes serve` נושאות את הכותרת המועדפת
`X-Hermes-Session-Token` (החוזה של `web_server._has_valid_session_token`
ב־Hermes 0.19.1, שנמנע מהתנגשות עם `Authorization` של reverse-proxy) ובנוסף
את `Authorization: Bearer <token>` הישן לתאימות לאחור — שתיהן נשלחות יחד ללא
probe מקדים של הגרסה. ה־WebSocket ב־bind של loopback מאומת אך ורק דרך
`?token=<session>`; מסלול ה־`?ticket=` החד־פעמי של `web_server._ws_auth_reason`
נבדק *רק* כאשר `auth_required=true` (bind ציבורי/OAuth "gated") ולעולם אינו
נבדק ב־loopback, ולכן ticket אינו יכול לאמת את ה־WS שלנו — session token הוא
החוזה הרשמי המדויק והיחיד לארכיטקטורה הזאת. אם בדיקת ה־health לא עוברת, התהליך
שהופעל נהרג ונאסף מיד (`taskkill /t /f` בלבד ממחזר את כל עץ התהליכים ב־Windows)
כדי שלא יישאר orphan שמחזיק את פורט ה־loopback.

## ממשק תכנותי

### Desktop Plugin

ה־Plugin משתמש רק ב־`@hermes/plugin-sdk`:

- `host.request()` ל־JSON-RPC.
- `host.onEvent()` לזרם אירועים.
- `host.state.*` למצב live של gateway, model, profile ו־session.
- `host.navigate()`, `host.logs()` ו־`host.restartGateway()`.

המקור מודולרי תחת `hermes-plugin/business-shell/src`. Rollup יוצר
`plugin.js` יחיד, משום שזה חוזה ה־loader. React וה־SDK נשארים external.
`verify:plugin` בודק שה־artifact אינו stale, שאין imports אסורים או JSX, **וכן
מאמת את כל סמלי ה־SDK / דלתות `host` / מתודות `PluginContext` / אזורי התרומה /
עובדות ה־loader וה־discovery שעליהם ה־Plugin נשען מול מקור ה־Desktop של Hermes
המותקן `0.19.1`** (`scripts/verify-plugin.mjs`). המקור נפתר דרך
`electron/paths.cjs` (`hermesHome`), הגרסה חייבת להיות בטווח, וכל חוסר/גרסה מחוץ
לטווח → כשל סגור (fail-closed). על מכונת build נקייה ללא Hermes מותקן, האימות
מתבצע מול snapshot חתום שנוצר ממקור אמיתי
(`scripts/hermes-desktop-contract.json`, נוצר ע"י `npm run gen:hermes-contract`
מהמקור המותקן; המקבילה ל־clean-room היא רכישת מקור ה־release ה־immutable הרשמית
ב־`installer/bootstrap`) — **לעולם לא נפילה שקטה לסימולציה**. `verify:plugin:release`
דורש את המקור המותקן האמיתי ומאמת התאמת sha256 מלאה מול ה־snapshot.

חשוב: `scripts/lib/probes/hermes/contract-harness.mjs` הוא **harness חוזה ליחידות
בלבד** — שחזור כתוב ביד של התנהגות ה־loader המתועדת, לבדיקות מהירות offline. הוא
**אינו** ה־loader האמיתי ואינו מובא כהוכחה ש־Hermes האמיתי טוען את ה־Plugin.
ההוכחה האמיתית: (א) `verify:plugin` מול המקור המותקן, ו־(ב) E2E ה־opt-in
`scripts/e2e-real-loader.mjs` (`npm run test:e2e:real-loader`,
`HERMES_BUSINESS_REAL_LOADER=1`) שמריץ את Hermes Desktop האמיתי בתוך sandbox מבודד
ומוכח־בר־שחזור (env ברשימת־היתר עם re-home לכל home/cache/config; snapshot/restore
מדויק־בייט של תת־עץ הרישום `hermes://` עם גיבוי עמיד ובר־התאוששות מקריסה; קטילת
צאצאים לפי זהות; הסרת שורש temp מדויק). הוא זורע משימת cron **מושהית** ומוכיח
שהדלת כוללת־מושהות מציגה אותה, ומפריד בין הוכחת ה־**CONTRACT** של ה־loader (התרומות
עלו) לבין קבלת מסלול־המשתמש (**CLICK-PATH**: לחיצת עכבר רגילה מנווטת/פותחת טאב).
בהרצה המוקשחת האחרונה מול Hermes 0.19.1 המותקן הריצה **עוברת מקצה לקצה**
(`ok:true`, exit 0): ה־CONTRACT עובר, השורה המושהית מוצגת דרך ה־backend הנלווה,
וקבלת מסלול־המשתמש מושגת דרך מסלול קלט אמיתי — **מקלדת**, לא force/dispatch/hash.
סדר הניסיון: תחילה לחיצת עכבר רגילה על פריט ה־nav בתקציב קצר (כדי שתשדרג אוטומטית
ל־`mechanism:'sidebar-pointer'` ביום שסביבת unity-DPR או תיקון upstream יהפכו אותה
לישירה), ואם היא נכשלת — ה־**command palette** הרשמי: `Ctrl+K`
(`nav.commandPalette`, ברירת מחדל `mod+k`) → הקלדת `לעסק` → שורת ה־`business.open`
שה־Plugin תורם (PALETTE_AREA) מודגשת אוטומטית (cmdk מדרג את ההתאמה הטובה ביותר
ראשונה) → **Enter** מריץ `host.navigate('/business')`; טאב ה־Automations (`משימות`)
נפתח אף הוא ב־Enter של המקלדת (הפעלת `<button>` נטיבית).

**תיקון לטענה קודמת:** ה"חסימה" הישנה של לחיצת העכבר **אינה** באג מוצר מוכח
ב־Hermes Desktop. השורש הוא התנהגות קואורדינטות של Playwright/Electron:
`window.devicePixelRatio ≈ 0.9` (zoom/HiDPI לא־יחידתי) מסיט את קואורדינטות ה־pointer
הסינתטיות, כך ש־`elementFromPoint` במרכז ה־rect פותר לאב־קדמון בגודל מלא (ה־sidebar
group או ה־`cmdk-root`) והלחיצה נדחית — אותה תופעה בשני widgets לא־קשורים, כלומר
artifact של הכלי/DPR ולא CSS פר־widget. קלט מקלדת אינו זקוק ל־hit-test קואורדינטתי,
ולכן מפעיל את האפרדנסים האמיתיים באמינות.

זהו **PASS של ריצת בדיקה, לא ראיית release ציבורית**: הסקריפט מדפיס `ok:true` אך
**אינו** כותב מעטפת ראיה — אין `real-loader.json`, ו־`capture-evidence.mjs` אינו
מטפל ב־real-loader — כך שההוכחה הזאת נשמרת בכוונה נפרדת ממערך ראיות ה־release
הציבורי. מסלול ה־hash router וה־`dispatchEvent` נותרים **דיאגנוסטיים בלבד** ואינם
מסמנים קבלה. אם **שני** מסלולי הקלט הרשמיים ייכשלו אי־פעם, הריצה עדיין נכשלת סגור
כ־user-path חסום (מדווח כבאג hit-test/קלט אפשרי) — לעולם לא PASS על סמך
CONTRACT־בלבד, ובאג קלט אמיתי לעולם אינו מוסתר.

### ארכיטקטורה כפולה (dual/hybrid) — מכוונת, לא קוד מת

המוצר מריץ במכוון שני ממשקים מעל אותו Hermes Home ו־Profile `default`:
Electron thin client קטן (הממשק הראשי, ה־widget הממותג תמיד־זמין) ו־Desktop
Plugin אופציונלי (`business-shell`) לחוויית Hermes המלאה. שניהם חולקים מצב אחד
(sessions/cron/skills/memory). זו החלטה ארכיטקטונית — ה־thin client נותן חוויה
קלה ותמיד־זמינה שה־Plugin לבדו אינו יכול לספק מחוץ לחלון Hermes, וה־Plugin נותן
מסכים עסקיים מלאים בתחזוקה נמוכה. אין כפילות של Runtime/Engine, ואין קוד מת.

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
session.resume
prompt.submit
session.interrupt
message.delta
message.complete
tool.start
tool.complete
status.update
```

Session שנוצר ב־Companion נמצא מיד דרך `session.list` ונפתח ב־Hermes המלא עם
אותו transcript. אין מסד שיחות נוסף.

Streaming נבנה מ־`message.delta` ומסתיים ב־`message.complete`. Stop שולח
`session.interrupt`. Tool Calls אינם מוצגים למשתמש כ־API names; שכבת presentation
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
וספקים נוספים לפי ה־registry של גרסת Hermes. הבדיקה האוטומטית של אשף ההגדרה
(`scripts/lib/probes/installed/setup-wizard.mjs`) קוראת את מצב ה־OAuth הקיים של
OpenAI Codex (`/api/providers/oauth`) ומאמתת שה־UI תואם ל־`logged_in` — היא אינה
מבצעת הפעלה. הפעלת provider ו־inference/Streaming חיים עם OpenAI Codex נצפו ידנית
על מחשב הבדיקה, ואינם משוחזרים על ידי בדיקה אוטומטית עצמאית (ה־E2E החי של
`e2e-hermes` רץ provider-free כברירת מחדל).

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

Telegram הוא Messaging Platform רשמי. המוצר משתמש רק ב־API הרשמי של Hermes
להגדרה, restart ו־test, ומסמן “מחובר” רק לאחר תשובת test תקינה. המעטפת מעבירה
ל־Hermes את ה־Bot Token ואת מזהה המשתמש; אין לה מנגנון הרשאה, allowlist, מצב
קריאה־בלבד או transport מקביל ל־Telegram. Hermes הוא הבעלים היחיד של החיבור.

הכיסוי האוטומטי ל־Telegram (`scripts/lib/probes/installed/connections.mjs`)
מאמת את כרטיס ה־Telegram מול `/api/messaging/platforms` ופותח/סוגר את דיאלוג
החיבור — הוא אינו שולח הודעה.

המנגנון החי הוכח בתצפית ידנית חד־פעמית: נוצר וחובר בוט ייעודי, ולאחר עצירה
מכוונת של ה־Gateway פעולת החיבור מהמעטפת הפעילה אותו מחדש, שמרה את ההגדרה
והעבירה test תקין.

בבדיקה החיה Gateway רשמי של Hermes התחבר ב־polling, קיבל הודעות משני המשתמשים
שהוגדרו ב־`TELEGRAM_ALLOWED_USERS`, העביר כל הודעה לסוכן ושלח את תשובת הסוכן
בחזרה. לוגי Hermes הראו `inbound → response ready → sending response` עבור שני
הסבבים. גם שליחת connectivity test דרך `hermes send --to telegram` הצליחה.
ה־Bot Token אינו מתועד ואינו נכלל בחבילת האבחון.

ה־plugin המקומי `business-whatsapp-policy` שולט רק ב־WhatsApp. בדיקות החוזה
מוודאות ש־Telegram אינו משפחה נשלטת ושגם נתיב `_send_telegram` של Hermes נשאר
ללא wrapper. כך אין שתי שכבות הרשאה שעלולות לסתור זו את זו.

### WhatsApp

שני מסלולים נחשפים במפורש, בלי להתחזות זה לזה:

- `whatsapp_cloud` — החיבור הרשמי של Meta לעסקים. דורש Meta Business, מספר עסקי
  ייעודי ו־webhook ציבורי. המעטפת מציגה אשף מקומי עבור Phone Number ID, Business
  Account ID, Access Token ו־Verify Token, ושומרת אותם דרך נקודות ה־Messaging
  הרשמיות של Hermes. ה־renderer אינו כותב קובצי הגדרה ואינו מקבל גישה ישירה
  למערכת הקבצים.
- `whatsapp` — חיבור לא רשמי מבוסס WhatsApp Web (Baileys) עם קוד QR. ה־QR נסרק
  ישירות במעטפת דרך נקודות ה־REST הרשמיות של Hermes:
  `POST /api/messaging/whatsapp/onboarding/start` → `GET …/{pairing_id}` (poll) →
  `POST …/{pairing_id}/apply`. הקוד מוצג עם `qrcode.react`, וההמלצה למספר ייעודי
  מודגשת.

#### בדיקת פתרון רשמי לפני הרחבה עצמאית

נבדקו התיעוד העדכני של Meta, התיעוד הרשמי של Hermes והקוד המותקן של
`gateway/platforms/whatsapp_cloud.py`:

- **המסלול הרשמי הקיים ב־Hermes הוא Meta Cloud API.** הוא תומך ב־webhook חתום,
  הודעות נכנסות, שליחה, מדיה, כפתורי אישור, הקלדה ואישורי קריאה. זה המסלול
  המומלץ למוצר עסקי. חיבור Baileys/QR נשאר חלופת POC ברורה ולא־רשמית.
- **Meta אינה מספקת הרשאת OAuth נפרדת לקריאה בלבד.**
  `whatsapp_business_messaging` משמשת גם לקבלת webhooks וגם לשליחה. לכן
  “קריאה בלבד” חייבת להיאכף באפליקציה/Runtime; אי אפשר להשיג אותה רק על ידי
  בקשת scope חלש יותר.
- **Hermes מספק רשמית `dm_policy` ו־allowlist**, אך `disabled`/allowlist מסננים
  את ההודעה לפני יצירת turn. הם אינם מצב “שמור באותו Session אך אל תריץ את
  הסוכן”. לכן הם מספיקים ל־“ענה רק לרשימה והתעלם מהשאר”, אך לא לדרישה שלנו:
  “קרא ושמור את כולם, ענה רק לנבחרים”.
- **Meta Coexistence הוא פתרון רשמי למספר שכבר נמצא ב־WhatsApp Business App.**
  הוא כולל Embedded Signup, סנכרון היסטוריה (עד 180 יום, בכפוף להסכמה),
  אנשי קשר ו־message echoes. קבוצות אינן נכללות בהיסטוריה. ההטמעה דורשת
  מעמד Tech Provider/Solution Partner ותשתית webhook.
- **Hermes `0.19.x` עדיין אינו מממש Coexistence.** אין בקוד טיפול ב־`history`,
  `smb_app_state_sync`, `smb_message_echoes` או Embedded Signup; אשף
  `hermes whatsapp-cloud` מבקש ידנית Phone Number ID, token, App Secret
  ו־webhook. לכן אי אפשר להציג את Coexistence כאפשרות עובדת “מהקופסה”.

החלטה: ב־POC משתמשים ב־Cloud API הרשמי כשיש חשבון Meta מתאים, ושומרים את QR
כחלופה מסומנת. ה־plugin העצמאי נשאר קטן ומוגבל לפער האמיתי בלבד — passive
ingest ואכיפת egress — ואינו מממש Connector, Session store או Agent Runtime.
למוצר ייצור יש להוסיף Embedded Signup/Coexistence מעל מתאם Cloud של Hermes,
או לתרום את התמיכה ל־Hermes upstream, במקום להעמיק את תלות ה־QR.

מקורות:
[Hermes Cloud API](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp-cloud),
[Hermes environment variables](https://hermes-agent.nousresearch.com/docs/reference/environment-variables),
[Meta permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions/),
[Meta Coexistence onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

#### מדיניות מענה fail-closed

הדרישה המרכזית: משתמש לא־טכני יכול לבחור מדיניות תגובה בטוחה, שנאכפת ב־Runtime של
Hermes ובשכבת ה־transport — לא רק ב־UI.

- **קריאה בלבד (`read_only`, ברירת מחדל):** כל הודעה נכנסת נשמרת ל־session store
  המשותף של Hermes, אך הסוכן לעולם אינו רץ ואין שום תופעת־לוואי יוצאת (תשובה,
  הקלדה, אישור קריאה, תגובה, עריכה/מחיקה, שליחה עצמאית או משימה מתוזמנת).
- **שיחות פרטיות נבחרות (`selected_chats`):** רק מספרי WhatsApp שנבחרו במפורש
  מקבלים מענה; כל השאר נשמרים אך לא נענים. בזמן `apply` אותה רשימה נכתבת גם
  ל־allowlist הרשמי של Hermes, כך שה־hook וה־auth הקיים מסכימים על אותה הרשאה.
  קבוצות ניתנות להגדרה בממשק Hermes המלא דרך `group_policy/group_allow_from`;
  ה־POC הפשוט אינו מציג אותן כאילו הוגדרו כשלא הוגדרו.
- מדיניות חסרה/לא תקינה → ברירת מחדל `read_only` (fail-closed).

**אכיפה** מסופקת על ידי plugin משתמש אמיתי של Hermes,
`business-whatsapp-policy`, המותקן ל־`<hermesHome>/plugins/` ומופעל דרך הפקודה
הרשמית `hermes plugins enable business-whatsapp-policy --no-allow-tool-override`:

1. **Hook `pre_gateway_dispatch`** (נקודת האכיפה הראשית) — לפני auth/pairing ולפני
   שהסוכן רץ. עבור צ׳אט לא־מורשה הוא מחזיר `{"action":"skip"}` ומבצע ingest פסיבי
   ל־transcript (זוג `user`/`assistant:NO_REPLY` כדי לשמור על alternation ולמנוע
   כפילויות לפי `message_id`). עבור צ׳אט מורשה בלבד — `{"action":"allow"}`.
2. **Guards על ה־platform registry** (הגנה בשכבת ה־transport, ברירת־מחדל‑חסום) —
   עוטפים את `adapter_factory` של `whatsapp` ואת `standalone_sender_fn`, ומרושמים
   כניסת `whatsapp_cloud` עטופה. עטיפת Cloud מסומנת כ־override של רכיב core ומאמתת
   credentials לפני חיבור, כדי לא להפעיל Cloud רק משום שהתלויות מותקנות.

   **בחירת המתודות היא contract‑driven, לא denylist שביר של תחיליות.** ה־plugin
   מחזיק allowlist מפורש של משטח ה־outbound שאומת מול מקור Hermes המותקן `0.19.1`
   עבור שתי המשפחות — המתאם הרשמי של Baileys
   (`plugins/platforms/whatsapp/adapter.py`) ומתאם ה־Cloud
   (`gateway/platforms/whatsapp_cloud.py`). כל מתודת שליחה/עריכה/מחיקה/הקלדה וכל
   ה־sink הרשתיים הפרטיים (`_send_media_to_bridge`, `_post_interactive`,
   `_send_read_receipt` …) נעטפים ונחסמים כאשר `can_reply` שקרי — **גם
   סינכרוני וגם אסינכרוני** (מתודת `def` רגילה לא נשארת פתוחה). מתודות ה־convenience
   של מחלקת הבסיס מנתבות אל אותם primitives עטופים, כך שהעטיפה מכסה את המשטח
   הטרנזיטיבי. הקלדה/אישורי קריאה מושתקים בשקט. במסלול Cloud נעטפת גם
   `_is_interactive_sender_authorized`, משום שכפתורי אישור/בחירה נפתרים במתאם לפני
   hook ה־dispatch הרגיל.

   **חוזה גרסה, כשל‑סגור — לא degrade עם לוג בלבד.** אם משפחת הפלטפורמה אינה מוכרת,
   אם חתימות ה־`PlatformEntry` שאנו עוטפים חסרות, או אם המתאם החי חשף מתודת
   outbound ציבורית **לא מזוהה** (drift), ה־plugin **משבית את החיבור** — ה־factory
   מחזיר מתאם ריק (הפלטפורמה לא נטענת) במקום לשרת מתאם לא־עטוף, ובכשל התקנה כולל
   מבטלים את רישום הפלטפורמות. בדיקות חוזה־גרסה (`tests/test_installed_contract.py`)
   בודקות את המקור המותקן עצמו (דרך מפרש ה־venv של Hermes) ונכשלות אם המשטח סטה
   מ־allowlist שלנו; הן מדלגות רק כאשר Hermes אינו מותקן.
   **שליחת Cloud out-of-process:** נכון ל־Hermes `0.19.x` מתאם ה־Cloud הוא רכיב
   core שאינו רשום ב־platform registry, ולכן אין לו `standalone_sender_fn`.
   המשמעות: שליחת Cloud מחוץ לתהליך ה־gateway (למשל cron בתהליך נפרד) פשוט אינה
   זמינה — לא “לא מאובטחת”. איננו ממציאים sender עצמאי ל־Cloud; ה־plugin רק
   משמר ועוטף `standalone_sender_fn` אם גרסת Hermes עתידית תחשוף אחד, כך ששליחה
   מתוזמנת עתידית תכבד את אותה מדיניות. שליחת Cloud חיה מתבצעת כיום רק in-process
   בתוך gateway פעיל.

ה־hook נרשם תמיד תחילה; גם כשל ב־passive ingest מחזיר `skip` ואינו יכול להפוך
הודעת read-only ל־dispatch רגיל. לפני התחלת QR המעטפת מאמתת מחדש שה־plugin
מופעל; receipt ישן אינו נחשב הוכחה להפעלה.

המצב נשמר ב־`<hermesHome>/business/whatsapp-policy.json` על ידי תהליך ה־main של
Electron (`electron/whatsapp-policy.cjs`), עם נורמליזציה זהה
(TS/`electron`/Python) של מזהי צ׳אט (טלפון, `+`, `whatsapp:`/`whatsapp_cloud:`,
`@s.whatsapp.net`/`@lid`). ההתאמה ב־`selected_chats` היא **שוויון מנורמל מדויק**
(לא substring/prefix), ונאכפת בכל המסלולים: sync, async, מתוזמן (standalone) ואינטראקטיבי.

**אמת ה־ACL ב־Windows (`electron/whatsapp-privacy.cjs`):** קובץ המדיניות מכיל PII
(המספרים המורשים). ב־NTFS ל־`chmod 0600` **אין** משמעות של סודיות — Node ממפה מצב
POSIX רק ל־read‑only attribute, לא להגבלת קריאה. לכן איננו טוענים ש־`0600` מגן
ב־Windows: גבול הסודיות הוא ש־Hermes home יושב תחת פרופיל המשתמש
(`%LOCALAPPDATA%\hermes`), שה־ACL שלו מוריש גישה למשתמש (ול־SYSTEM/Administrators)
בלבד. ב־POSIX עדיין נכתב `0600` כי שם זהו גבול אמיתי. **הרחקה מאבחון:** חבילת
האבחון (`electron/diagnostics.cjs`) היא allow‑list נוקשה — היא פולטת רק סיכום
runtime מסונתז ו־README ואינה קוראת/עוברת על ה־home, כך שקובץ המדיניות מוחרג
מעצם הבנייה; `diagnosticsExclusions()` מתעד את החוזה לכל אספן עתידי.

שמירת המדיניות מסנכרנת גם את מנגנוני Hermes הרשמיים דרך REST, לפני כתיבת
הקובץ המקומי: Baileys מקבל `WHATSAPP_DM_POLICY=pairing` ו־
`WHATSAPP_ALLOWED_USERS`; Cloud מקבל `WHATSAPP_CLOUD_DM_POLICY=pairing` ו־
`WHATSAPP_CLOUD_ALLOWED_USERS`. כך כל הודעה יכולה להגיע ל־passive ingest,
אבל turn פעיל וכפתורים אינטראקטיביים מותרים רק למספרים שנבחרו. סדר הכתיבה
שומר בכל רגע על החיתוך המחמיר בין המדיניות הישנה והחדשה.

ראה [../hermes-plugin/business-whatsapp-policy](../hermes-plugin/business-whatsapp-policy).

בדיקת מנגנון חיה הפעילה `hermes serve` מקומי עם token פרטי, קראה
`/api/health`, התחילה onboarding, צפתה ברצף
`installing → starting → waiting` ואימתה שקיים `qr_payload`. סריקת ה־QR וקבלת
הודעה נכנסת חיה נצפו ידנית פעם אחת: ההודעה נשמרה ב־Session ונחסמה במצב read-only
לפני inference או outbound delivery. זו תצפית ידנית; הכיסוי האוטומטי ל־WhatsApp
מכסה מדיניות וonboarding UI (`e2e-installed-whatsapp-ui`, `e2e-whatsapp-onboarding`),
לא הודעה חיה.

## Scheduled Tasks

שני משטחים מציגים משימות מתוזמנות, ו**שניהם קוראים את אותו scheduler רשמי יחיד
של Hermes** (`cron/jobs.py`, המאוחסן ב־`<HERMES_HOME>/cron`) עם `profile=default`.
אין store מקביל, אין cache, ואין scheduler חלופי. המפתח לכל הסעיף הזה הוא ההבדל
בין שני שערי הקריאה של Hermes:

- `cron.jobs.list_jobs(include_disabled=False)` הוא ברירת המחדל של המנוע —
  **פעילות בלבד** (הוא מסנן `enabled=False`).
- `cron.jobs.list_jobs(include_disabled=True)` מחזיר **פעילות + מושהות**.

### Companion — REST Cron הרשמי (כבר כולל paused)

ה־Companion (לקוח Electron מול `hermes serve`) פונה ישירות ל־Cron API הרשמי. חוזי
ה־REST המדויקים (route הדשבורד ב־`hermes_cli/web_server.py`, בהתאמה למקבילו
ב־`gateway/platforms/api_server.py`):

- `GET /api/cron/jobs` — list. **החוזה הרשמי כולל משימות מושהות:** ב־Hermes
  `0.19.1` ה־route הזה קורא במפורש `list_jobs(include_disabled=True)`
  (`web_server.py::list_cron_jobs → _call_cron_for_profile(name, "list_jobs",
  True)`), ולכן משטח ה־REST של ה־Companion רואה פעילות ומושהות מהקופסה — בלי
  שכבה נוספת.
- `POST /api/cron/jobs` — create (גוף `CronJobCreate`).
- `POST /api/cron/jobs/{id}/pause` ו־`/resume` — הפעלה/השהיה.
- `PUT /api/cron/jobs/{id}` — **עריכה** אטומית עם גוף `{ updates: {...} }` (חוזה
  `CronJobUpdate`). ה־UI שולח רק את השדות שהשתנו (diff מול המקור), כך שעריכה לעולם
  לא דורסת שדות שלא נגעו בהם. שינוי enabled נשאר על pause/resume הייעודיים.
- `POST /api/cron/jobs/{id}/trigger` — **הרצה מיידית** (fire now).
- `DELETE /api/cron/jobs/{id}` — **מחיקה**.

מחיקה והרצה־עכשיו הן פעולות בלתי הפיכות ולכן דורשות אישור (confirm) ב־UI; עריכה
נפתחת בדיאלוג ממולא מראש. התאמת schedule תומכת גם בגרסה הישנה כמחרוזת וגם במבנה
`{display, expr}`. המשתמש רואה “ימים א׳–ה׳ בשעה 08:00”, לא ביטוי Cron.

### Desktop Plugin — פער ה־paused ופתרון ה־backend הקריא־בלבד

ה־Desktop Plugin (`business-shell`) אינו פונה ל־REST ההוא. הוא רץ בתוך Hermes המלא
ומדבר עם ה־Gateway דרך JSON-RPC. שער ה־Cron של ה־Gateway, `cron.manage` (פעולת
`list`), הוא **פעיל בלבד** — הוא מסתמך על ברירת המחדל `include_disabled=False`.
המשמעות: ברגע שמשימה מושהית, היא **נעלמת** מהמסך העסקי הפשוט, אף שהיא עדיין קיימת
ב־scheduler הרשמי. המוצר דורש שמשימות מושהות יישארו גלויות עם pill “מושהה” ומתג
resume.

הפתרון **אינו** store צל (שהיה סוטה ומשקר), אלא **plugin backend קריא־בלבד של
המשתמש**, שקורא את אותו scheduler סמכותי:

- **מיקום ורישום.** הקובץ `<HERMES_HOME>/plugins/business-shell/dashboard/
  plugin_api.py` חושף `router` של FastAPI. ה־web server הרשמי של Hermes ממַנה אותו
  בהפעלה תחת `/api/plugins/business-shell/` דרך `hermes_cli/web_server.py::
  _mount_plugin_api_routes`, מאחורי אותו middleware של אימות דשבורד ככל route
  אחר תחת `/api` — ה־plugin **יורש** את האימות של Hermes ואינו מוסיף אימות משלו.
  ה־import של ה־backend מוגבל רשמית למקורות `bundled`/`user`; plugin מסוג `project`
  (מ־CWD) לעולם אינו מיובא כקוד Python (הקשחת GHSA-5qr3-c538-wm9j).
- **הגעה מה־plugin.** ה־Desktop Plugin קורא אותו דרך `ctx.rest('/cron/jobs')`.
  ה־door הזה **נעול־namespace בבנייה** ל־prefix של ה־plugin עצמו
  (`/api/plugins/business-shell`): הוא דוחה `..` ואינו יכול לפנות ל־route ליבה או
  ל־namespace של plugin אחר. לכן זו רק תצוגה כוללת־paused של אותו scheduler רשמי.
- **המקור האחד.** ה־backend עונה ל־`/cron/jobs` בקריאה
  `cron.jobs.list_jobs(include_disabled=True)` — **בדיוק אותה קריאה** של route
  הליבה `/api/cron/jobs`. התהליך הרץ הוא תהליך הפרופיל הפעיל (עם ה־`HERMES_HOME`
  שלו), כך שקריאה in-process פותרת את המשימות של הפרופיל הנכון. אין cache ואין
  store מקביל.
- **מוטציות נשארות רשמיות.** ה־door הזה קריא־בלבד בלבד. יצירה, השהיה, resume
  ומחיקה נשארות פעולות scheduler רשמיות דרך ה־RPC `cron.manage` (וב־Companion דרך
  ה־REST הרשמי). ה־paused door מוסיף **ראייה** בלבד, לא כתיבה.
- **הקרנת שדות בטוחה.** ה־backend מקרין כל שורת scheduler ל־allow-list מינימלי
  (`id, name, enabled, schedule, schedule_display, state, next_run_at`, ועוד
  aliases ישנים) **לפני** שהיא עוזבת את התהליך. מסך ה־automations מציג רק זהות,
  קצב אנושי, ה־pill/מתג ואת ההרצה הבאה — לעולם לא prompt, יעד מסירה או תוכן עסקי.
  לכן prompt, נמען או secret אינם יכולים לדלוף דרך משטח ה־paused, גם אם שורת
  scheduler נושאת אותם.
- **fallback מנוון (degraded).** כל שגיאת scheduler ב־backend **נכשלת סגור** לגוף
  תקין וריק (`{jobs: [], paused_listing_supported: false, degraded: true}`) —
  לעולם לא טקסט חריגה שעלול להדהד prompt או path. ה־plugin מזהה את הדגל הזה (וגם
  door חסר, SDK ישן, או remote OAuth שבו `ctx.rest` הוא no-op) ומתדרדר **בכנות**
  ל־door הפעיל־בלבד `cron.manage`, במקום להעמיד פנים שיש תמיכת paused.
- **סמנטיקת enable של הקונפיג.** plugin דשבורד־בלבד אינו agent-discoverable, ולכן
  `hermes plugins enable` אינו יכול לפתור אותו; ההפעלה המאושרת היא ה־allow-list
  `plugins.enabled` ב־`<HERMES_HOME>/config.yaml` שאותה קורא ה־mount gate. ה־enable
  משכפל את `hermes plugins enable` **במדויק**: להוסיף את המזהה ל־`plugins.enabled`
  **וגם** להסיר אותו מ־`plugins.disabled`. חוקיות ההפעלה היא לכן **enabled וגם
  not-disabled** — משום ש־`disabled` של Hermes גובר, מזהה שנמצא בשתי הרשימות לעולם
  אינו נטען. גם ה־installer (`electron/backend-install.cjs`) וגם ה־gate של
  ה־PowerShell (`installer/lib/enable_plugin.py`, `--check`) אוכפים את הסמנטיקה
  הזאת ונכשלים־סגור על YAML פגום, מסמך שאינו mapping, אזכור בהערה, או רישום
  disabled-only.
- **התקנה אטומית עם rollback.** `installCompanionBackend` מצלם snapshot של
  `config.yaml` ושל קובצי ה־backend הקיימים **לפני** כל כתיבה, מפעיל בקונפיג
  **תחילה**, ורק אז כותב את ה־payload ל־`<HERMES_HOME>/plugins/business-shell/
  dashboard/`. אם commit ה־payload נכשל אחרי הפעלת הקונפיג, **שניהם** מגולגלים
  לאחור לבתים הקודמים המדויקים (וספרייה שלא הייתה קיימת נמחקת), כך שלעולם לא נשאר
  קונפיג שמצהיר על door מותקן בלי קבצים מאחוריו. ההתקנה best-effort ולא־פטאלית: היא
  לעולם אינה חוסמת את התקנת ה־Desktop Plugin, אלא מתדרדרת ל־door הפעיל־בלבד.

מחיקה והרצה־עכשיו נשארות פעולות בלתי הפיכות שדורשות אישור ב־UI, בשני המשטחים.

### ראיות בדיקה

- **בדיקת יחידה.** `cron-rest.test.ts` מקבעת את חוזי ה־REST של ה־Companion
  (`PUT`/`{updates}`, trigger, delete). מבחני Python של ה־enable
  (`installer/lib/test_enable_plugin.py`, `test_enable_disabled_precedence.py`)
  מקבעים את סמנטיקת ה־enabled-וגם-not-disabled ואת ה־rollback־סגור.
- **E2E חי ומבודד — cross-door.** `provePausedCronCrossDoor`
  (`scripts/lib/probes/hermes/shared-state.mjs`, דרך
  `test:e2e:hermes-shared-state`) יוצר משימה מול Hermes חי ב־`HERMES_HOME` מבודד
  אחד, משהה אותה דרך `cron.manage`, ומוכיח: ה־list הפעיל־בלבד של `cron.manage`
  **משמיט** אותה, בעוד `GET /api/cron/jobs` (REST) **וגם** קובץ ה־`cron/jobs.json`
  על הדיסק מסכימים שהיא `enabled:false`. אחרי resume היא חוזרת ל־list — מוכיח
  scheduler אחד ללא cache.
- **E2E חי ומבודד — plugin door.** `provePluginPausedDoor`
  (`scripts/lib/probes/hermes/plugin-paused-door.mjs`) קורא את המשימה המושהית חזרה
  דרך ה־door הנעול־namespace `ctx.rest('/cron/jobs')`, מאמת שהיא מופיעה
  `enabled:false`, ש**אין** בה `prompt`/`deliver` (ההקרנה הבטוחה עבדה), ושניסיון
  escape של `..` נדחה לפני כל I/O. ה־home המבודד נמחק בסוף — הפרופיל החי לעולם
  אינו נוגע.

### צירוף קבצים ו־PDF

צירופים מנותבים לפי סוג ל־RPC הרשמי: תמונות דרך `image.attach`/`image.attach_bytes`,
קבצים כלליים דרך `file.attach` (מחזיר `@file:` ref). **PDF** מנותב תחילה ל־`pdf.attach`
הרשמי (עיבוד עמוד־לתמונה ל־vision, עם `path` או `content_base64`+`filename`). נפילה
ל־`file.attach` מתרחשת **רק** כאשר ה־gateway אינו מכיר את השיטה (JSON-RPC `-32601`);
כל שגיאה אחרת (למשל `pdftoppm` חסר) מוצפת כפי שהיא. ה־transport משמר את קוד ה־JSON-RPC
דרך `HermesRpcError` כדי לזהות method-not-found במדויק.

### קשיחות demo ב־production

fixtures של demo **מנוטרלים קשיח** ב־build ייצור ארוז. `?demo=1` מכובד **רק** כאשר
ה־build מתיר demo — שרת dev (`import.meta.env.DEV`), או build QA/בדיקה ייעודי שאופה
לתוכו `VITE_ALLOW_DEMO` (ראה `npm run build:qa` / `package:win:qa`). הדגל נגזר
ממצב ה־build ב־`vite.config.ts` (`--mode qa`); אין קובץ `.env.qa`. `npm run build` /
`package:win` (מצב production) **אינם** אופים את הדגל, ולכן
ב־executable שהלקוח מקבל אין נתיב קוד שמגיע ל־demo backend — `?demo=1` אינרטי לגמרי.
בנוסף, `vite.config.ts` (`stripDemoFixtures`) מחליף את מודול הכניסה ל־demo ב־stub
שזורק בכל build שאינו demo, כך ש־`demo-api`/`demo-rpc`/`demo-data` עוברים tree-shaking
ואינם קיימים **פיזית** ב־bundle הארוז — לא רק בלתי־נגישים. build ארוז ללא גשר preload
**נכשל סגור** (`bridgeMissing`) במקום לפברק נתונים.
הלוגיקה מרוכזת ב־`isDemoBuildAllowed`/`resolveClientMode` ומכוסה ב־`hermes-mode.test.ts`.
ה־e2e של demo מותקן (`e2e-installed-attachment-ui.mjs`) רץ מול חבילת QA, לא מול הייצור.

### התראות Curator/למידה

מודול electron רשמי (`curator-insights.cjs`) קורא את `GET /api/curator` ו־
`GET /api/learning/graph` בלבד ומחזיר את המטענים הגולמיים דרך IPC. הרנדרר מנסח מהם
התראות ידידותיות (`deriveCuratorNotifications`) — לעולם לא ממציא מספרים או skills:
כאשר שדה חסר, ההתראה שלו פשוט מושמטת. מוצג במסך ה־Skills.

## מדיניות תאימות מקור־יחיד וערוץ ההפצה

מדיניות התאימות ל־Hermes מרוכזת בקובץ קנוני יחיד: `hermes-compat.json` (טווח
`>=0.19.0 <0.20.0`, הגרסה המאומתת `0.19.1`, ומפת ה־pins). כל שכבה מטבעה מחזיקה עותק
משלה (bundle של TS, תהליך electron ראשי, סקריפט build, plugin של Python בתוך venv של
Hermes, ו־PowerShell עצמאי — אף אחת אינה יכולה לייבא את האחרות ב־runtime). מה שהופך
את ה־JSON ל**מקור־האמת** הוא בדיקת ה־drift `src/lib/hermes-compat-policy.test.ts`,
שמאמתת שכל עותק (renderer `compat.ts`, `electron/hermes-compat.cjs`,
`scripts/plugin-sdk-contract.mjs`, `contract.py` של ה־plugin, וליטרלי הטווח ב־
`bootstrap.ps1` + ה־pins ב־`Release.ps1`) זהה ל־JSON. המדיניות אינה יכולה להתפצל בשקט.

**אי־התאמת ערוץ (CalVer מול semver).** תגי ה־release של upstream הם CalVer
(`v2026.7.30`) ואינם נושאים משמעות semver, בעוד ה־CLI המותקן מדווח `0.19.1`. הגרסה
הסמכותית שכל release מתקין היא `__version__` שב־`hermes_cli/__init__.py` באותו tag —
בדיוק מה ש־`hermes --version` ידווח. לכן ה־bootstrap הדק **קורא את `__version__`
מהמקור לכל tag מועמד** (`Release.ps1: Get-ReleaseSourceVersion`) ובוחר את ה־release
החדש ביותר שגרסתו בטווח — לעולם לא מפרש tag כ־semver ולא גורף טקסט חופשי. כשקריאת
המקור אינה זמינה (rate-limit/רשת), נופלים חזרה ל**מפת pins בשליטתנו** (מקושרת ל־JSON).
אם אף release אינו כשיר — **נכשל סגור**. תהליך העדכון/אמון מתועד ב־`hermes-compat.json`.

`verify:bootstrap` מריץ **gate דטרמיניסטי offline** (unit-suite של installer/lib +
בידוד home; `scripts/test-bootstrap-lib.ps1`) שמוכיח את לוגיקת הבחירה הבטוחה־ל־CalVer
ללא רשת, ולאחריו **probe חי** ל־GitHub. כשל ב־probe החי (רשת/rate-limit/סחיפת טווח
upstream) מדווח כ־`EXTERNAL-GATE` ברור ויוצא 0 — לא כשל שקט של ה־build.

## עדכונים

בדיקת הזכאות משתמשת ב־API הרשמי:

```text
/api/hermes/update/check
```

על Windows לא ניתן לעדכן מתוך `hermes serve`, משום שה־executable שמבקשים
להחליף עדיין פתוח. לכן Electron מתזמר את updater הרשמי בסדר בטוח ומאומת. סדר
התזמור (`electron/hermes-update-flow.cjs`, מוזרק ל־DI ונבדק לכל סדר כשל):

1. **Preflight לפני כל מוטציה — לפני עצירה או גיבוי.** תחילה **gate של שיטת
   ההתקנה**: אם ההתקנה אינה git ואינה layout מנוהל מוכר (`hermes-agent`
   עם `pyproject.toml`), העדכון נעצר מיד ללא שינוי. אחר כך `hermes update
   --check` (קריאה בלבד), ואז **preflight תאימות** — להתקנת git נקרא ה־
   `__version__` שב־`origin/main` (`git show origin/main:hermes_cli/__init__.py`)
   והעדכון מבוטל אם היעד חורג מהטווח הנתמך `>=0.19.0 <0.20.0`. כל אלה קורים
   *לפני* שעוצרים את ה־runtime/gateway, כך שעדכון לא־כשיר לעולם אינו מפיל את
   ה־runtime.
2. **עוגן rollback.** מיד לאחר ה־preflight, עוד לפני כל מוטציה, נלכד ה־commit
   המדויק של checkout ההתקנה (`git rev-parse HEAD`).
3. **מוטציה.** עוצרים runtime+gateway, סוגרים רק תהליכי Hermes Desktop תחת
   ה־installation root המאומת, ואז נוצר **גיבוי מלא (ZIP)** דרך הפקודה הרשמית
   `hermes backup --output <path>`. הגיבוי מאומת עם **adm-zip הקיים** — נפרסת
   **ספריית המרכז (central directory)** של ה־ZIP (שנמצאת בסוף הקובץ), כך שגיבוי
   שנקטע באמצע (דיסק מלא, תהליך שנהרג) נדחה גם אם הוא מתחיל בחתימת `PK`; ארכיון
   ריק (אפס entries) נדחה גם הוא. רק אז רץ `hermes update --yes` (ששומר בנוסף
   snapshot מהיר משלו), ולבסוף הפעלה מחדש ו־`/api/health`.
4. **התאוששות מכשל אחרי מוטציה.** אם משהו נכשל אחרי שהמוטציה החלה: להתקנת git
   מבצעים `git reset --hard <עוגן>` על **checkout הקוד בלבד**
   (`<hermesHome>/hermes-agent`). המידע של המשתמש — `sessions/`, `skills/`,
   `memories/`, `state.db` — הוא sibling של ה־checkout, מחוץ ל־work tree, ולכן
   reset לעולם אינו נוגע בו; Hermes autostash־ה שינויים מקומיים ו־`reset --hard`
   אינו נוגע ב־stash. אם ההתקנה אינה git (אין restore רשמי in-place בטוח לריצה
   אוטומטית), נכשלים **fail-closed**: אין ניחוש הרסני, אלא הודעה כנה עם נתיב
   הגיבוי המאומת והפניה לתמיכה.

נתיב הגיבוי מוחזר ומוצג למשתמש. אין כאן מנגנון הורדה, גיבוי, restore או update
חלופי — הכול דרך הפקודות הרשמיות של Hermes. חוזה התאימות משותף בין הצד הרנדרר
(`src/lib/hermes/compat.ts`) לצד ה־main (`electron/hermes-compat.cjs`) ו־
`scripts/plugin-sdk-contract.mjs`.

הזרימה עברה בפועל מ־Hermes `0.19.0` ל־`0.19.1`. לאחר העדכון התקבל
`update_available=false`, ‏`behind=0`; Telegram ו־WhatsApp חזרו ל־connected.
ה־snapshot לפני ואחרי היה זהה: 70 Sessions, ‏64 Skills, משימה אחת וה־Skill
שנוצר ב־POC נשמרו. Profile, Sessions, Memory ו־Skills אינם חלק מתיקיית קוד
ה־release ולכן גם ה־bootstrapper אינו מוחק אותם.

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

המתקין המלא (Alpha לא־חתום) כולל את ה־Companion ואת bootstrap payload. מתקין הרשת
הזעיר כולל bootstrap, Plugin ו־Skill; Hermes עצמו יורד מה־release הרשמי,
וה־Companion יורד לפי manifest חיצוני עם גרסה, URL ו־SHA-256.

ה־artifact שנבנה והותקן מקומית הוא `release/העוזר לעסק Setup <גרסה>.exe` — build
מקומי של Alpha, **לא חתום ולא artifact הפצה**; הגרסה (`0.3.x`) אינה מקובעת בפרוזה
כדי שלא תוצג כ"סופית" או כניתנת־להפצה. הגודל וה־SHA-256 המדויקים משתנים בכל build
ולכן אינם משוכפלים בפרוזה; מקור האמת הוא
הקובץ הנוצר `release/SHA256SUMS.txt` (git-ignored), הנכתב על ידי
`npm run checksums` מעץ ה־release הנוכחי.

מנגנון הרשת עבר E2E מול שרת loopback: הורדת manifest, אימות SHA-256 והתקנה
שקטה של ה־Companion הסופי. artifact רשת לפרסום עדיין דורש
`COMPANION_MANIFEST_URL` יציב ב־HTTPS; הקובץ הקיים ב־`release/` אינו מוצג
כמתקין הפצה סופי ללא כתובת כזו.

עמידות לשינויים נשענת על:

- טווח גרסאות מפורש, ולא “latest” עיוור.
- בדיקת SDK בזמן build והתקנה.
- adapter מרכזי לצורות Session, Cron ו־Messaging.
- API source-of-truth במקום local UI flags.
- Plugin generated עם stale-artifact gate.
- contract tests ו־E2E מול Hermes חי.

שינוי breaking ב־Hermes `0.20+` דורש העלאת טווח רק לאחר בדיקת חוזה. זו
הגנה מכוונת, לא הבטחה בלתי אפשרית ש־API עתידי תמיד יהיה תואם.

## אימות release (verify:release) ו־E2E opt-in

`npm run verify:release` מריץ אך ורק בדיקות דטרמיניסטיות ובטוחות שאינן דורשות
Hermes חי, אפליקציה מותקנת או רשת: `npm test` (Vitest — כולל צירוף קבצים,
reducer אירועי הצ׳אט, חוזה התאימות, אימות הגיבוי ותזמור העדכון), בדיקות מדיניות
ה־WhatsApp ב־Python (`test:plugin:policy`), `verify:plugin` ו־`verify:bootstrap`.

חבילות ה־E2E החיות הן **opt-in בלבד** ואינן חלק מ־`verify:release`, משום שהן
דורשות binary מותקן, `hermes serve` חי או שירותים חיצוניים:

- `test:e2e:hermes` — מול Hermes חי מקומי.
- `test:e2e:installed-ui` — האפליקציה המותקנת (זרימת onboarding מלאה).
- `test:e2e:installed-attachment-ui` — צירוף קבצים באפליקציה המותקנת (stub של
  דיאלוג הקבצים + transport דמו, דטרמיניסטי אך דורש binary מותקן).
- `test:e2e:installed-whatsapp-ui` / `test:e2e:whatsapp` — מדיניות WhatsApp.
- `test:e2e:installed-update` — זרימת העדכון באפליקציה המותקנת.
- `test:e2e:bootstrap-clean` / `test:e2e:bootstrap-companion` — התקנות נקיות.

## תוצאות קבלה — 31 ביולי 2026

- בדיקות Vitest (‏60 קבצים, ‏356 עברו, ‏1 דילוג) ובדיקות מדיניות ה־WhatsApp
  ב־Python (‏40) עברו.
- Plugin contract, bootstrap resolver, אימות Git blob של install.ps1 הרשמי
  ו־TypeScript/Vite build עברו.
- `npm audit --omit=dev` החזיר `0` חולשות; Electron שודרג ל־`43.2.0`.
- נשארו 16 advisories מסוג high בתלויות כלי האריזה של electron-builder;
  הן אינן ב־production dependency tree, ול־npm אין כרגע מסלול תיקון שאינו
  downgrade לגרסה ישנה ופגיעה יותר.
- `clarify.request/respond` עבר גם ברמת RPC וגם ב־UI; הסוכן שאל שאלה אמיתית
  וקיבל את התשובה דרך אותו request id.
- Streaming, `session.resume`, Stop חי באמצעות `session.interrupt`, ‏Session משותף
  ו־`tool.start/tool.complete` עם אותו tool id עברו מול Hermes חי.
- מדיניות WhatsApp עברה E2E באפליקציה המותקנת בשני מצבי המדיניות; QR אמיתי
  הופק, וה־plugin המותקן הוכיח ש־Cloud נוצר דרך factory עטוף ושכפתור
  אינטראקטיבי חסום ב־read-only.
- בתצפית ידנית חד־פעמית, לאחר סריקת ה־QR התקבל אירוע נכנס ונשמר פסיבית ב־Session
  של Hermes: לוג ה־gateway הראה `business_whatsapp_read_only`; מסד הנתונים הראה
  0 tokens, ‏0 API/Tool Calls ו־0 delivery obligations, ולכן המופע הזה לא שלח תשובה.
  אין לכך בדיקה אוטומטית עצמאית — הכיסוי האוטומטי הוא מדיניות וonboarding UI.
- Telegram: הכיסוי האוטומטי מאמת את הכרטיס מול `/api/messaging/platforms` ואת
  דיאלוג החיבור, וראיה מכונתית (`docs/evidence/telegram.json`, ב־verify:evidence)
  מתעדת polling תקין, bot token תקף ומאזין יחיד ללא webhook; הודעה נכנסת היסטורית
  הגיעה ל־Hermes ונחסמה בהיעדר הרשאה, וה־allowlist הנוכחי מאשר את השולח; הודעת
  בדיקת־חיבור אחת בלבד נשלחה ואומתה דרך שליחת Hermes הרשמית. סבב טרי ומלא של
  הודעה מהמשתמש → סוכן → תשובה לאחר ההרשאה נותר הצעד הידני האחרון, לא בדיקה אוטומטית.
- Skill ו־Scheduled Task עברו מול APIs הרשמיים. פער ה־paused של `cron.manage`
  הפעיל־בלבד נסגר דרך ה־plugin backend הקריא־בלבד (`plugin_api.py` →
  `list_jobs(include_disabled=True)`), והוכח cross-door מול Hermes חי ב־home מבודד.
- diagnostics ZIP עבר בדיקת allowlist.
- המתקין המלא הותקן עם exit code `0`; מסלול מתקין הרשת עבר E2E מלא מול manifest
  מקומי מאומת, אך artifact פרסום ממתין ל־URL HTTPS אמיתי.
- EXE `0.4.0-alpha.1`, קיצורי Desktop/Start Menu ואייקון המוצר אומתו.
- Google זמין אך לא מחובר ללא credentials והסכמה של המשתמש.
- build ה־POC אינו חתום; release מסחרי דורש certificate וחתימת קוד.

## תוספת אימות — התקנה, OAuth ואשף

ה־bootstrap נבדק מול `HermesHome` ריק וקצר תחת `%TEMP%`, בלי אפשרות ליפול חזרה להתקנה
הגלובלית. הבדיקה הורידה את `v2026.7.30`, התקינה Hermes Agent `0.19.1`, אימתה את חוזה
Desktop Plugin SDK, התקינה את ה־Plugin ואת `business-bootstrap`, והשוותה את hashes
של הקבצים ל־install receipt. סביבת הבדיקה נמחקה לאחר ההוכחה.

למתקין הרשמי מועברים `-NonInteractive -Json -IncludeDesktop`. מצב JSON חשוב משום
שה־catch האינטראקטיבי של `install.ps1` עלול להדפיס כשל בלי exit code לא־אפס. המעטפת
לוכדת stdout/stderr, דורשת קיום ממשי של `venv\Scripts\hermes.exe`, ואינה מסתפקת בקוד
היציאה.

OpenAI Codex מחובר דרך חוזה OAuth הרשמי:

```text
GET    /api/providers/oauth?profile=default
POST   /api/providers/oauth/openai-codex/start?profile=default
GET    /api/providers/oauth/openai-codex/poll/<session>?profile=default
DELETE /api/providers/oauth/sessions/<session>?profile=default
```

בתצפית ידנית על מחשב הבדיקה `logged_in=true`; בחירת “השתמש בחיבור הזה” הפעילה את
provider `openai-codex`, ו־inference + Streaming עברו — הפעלה ו־inference חיים אלה
הם תצפית ידנית, לא בדיקה אוטומטית עצמאית. אסימון OAuth אינו נחשף ל־renderer.
גם API keys נשמרים רק לאחר `/api/providers/validate` עם `ok=true`; כשל רשת או מפתח
דחוי אינו נכתב ל־Hermes.

אשף ההקמה נבדק בשני מצבים:

- `HERMES_HOME` ריק: זוהה `installed=false` והוצג כפתור התקנה פעיל.
- Hermes קיים: הוצג מצב פועל, מסך Provider הציג את Codex OAuth הקיים, וכפתורי
  Google Workspace ו־Telegram פתחו את תהליכי החיבור הרשמיים.

Google נבדק גם במסלול כשל בטוח, וזהו המסלול המכוסה אוטומטית
(`scripts/lib/probes/installed/connections.mjs`): קובץ client secret חסר נדחה,
וסטטוס האימות נשאר ללא שינוי. השלמת consent אמיתי עדיין דורשת קובץ Google של
המשתמש. אבחון ה־Telegram החי מתועד כעת גם בראיה מכונתית מעורפלת
(`docs/evidence/telegram.json`, נאכפת ב־verify:evidence); הסבב הטרי המלא לאחר
ההרשאה נותר תצפית ידנית.

## מטריצת קבלה

| דרישה | מצב | ראיה |
|---|---|---|
| התקנה בלי Terminal | עבר | clean bootstrap ל־Hermes Home ריק + NSIS מותקן exit 0 |
| חיבור Provider | עבר (אוטומטי: קריאת מצב) | הבדיקה קוראת `logged_in` ומאמתת UI; activation + inference חיים = תצפית ידנית |
| היכרות עם המשתמש והעסק | עבר | `business-bootstrap` הפעיל `clarify.request/respond` |
| חיבור שירות חיצוני | עבר (אוטומטי: כרטיס+דיאלוג+ראיה מכונתית) | Telegram: אימות כרטיס מול `/api/messaging/platforms` + דיאלוג חיבור + `telegram.json` (polling תקין, bot תקף, מאזין יחיד ללא webhook, inbound היסטורי הגיע ונחסם בהיעדר הרשאה, allowlist נוכחי מאשר, הודעת בדיקה אחת נשלחה); סבב טרי מלא לאחר הרשאה = תצפית ידנית; Google: כשל בטוח אוטומטי, ממתין ל־consent |
| שיחה ו־Streaming | עבר | `message.delta`, Stop ו־`message.complete` בבינארי המותקן |
| הצגת ואישור פעולות | עבר | מצב manual זמני; destructive delete נדחה והמצב הוחזר ל־smart |
| משימה מתוזמנת | עבר | create, list, pause ו־cleanup דרך Cron API; המשימה המושהית גלויה גם ב־REST/דיסק וגם דרך ה־plugin backend door הקריא־בלבד (`list_jobs(include_disabled=True)`), ונעדרת מ־`cron.manage` הפעיל־בלבד — scheduler אחד ללא cache |
| Skills של Hermes | עבר | Skill קיים + Skill חדש שנראה ב־Skills API ובממשק המלא |
| State משותף | עבר | Session מה־Companion נמצא מיד דרך `session.list` |
| תקינות וחבילת אבחון | עבר | health/update + ZIP עם שני קבצי allowlist בלבד |

אין חסם קוד ידוע ל־Google או Telegram. השלמת Google עדיין דורשת consent ופרטי
גישה של המשתמש. סריקת WhatsApp Web ובדיקת intake חיה במצב read-only הן תצפית
ידנית חד־פעמית (הכיסוי האוטומטי הוא מדיניות וonboarding UI); פרטי הגישה אינם
נמצאים ב־repository או בחבילת האבחון.

## שותף עסקי (Business Partner) וארגז חול נייטיב

מצב **שותף עסקי** הוא שכבת־על אופציונלית ועמידה מעל אותה התקנת Hermes יחידה
ואותו Profile `default`. אין Runtime, Scheduler, Memory או Personality Engine
חלופיים, ו־`SOUL.md` אינו נוגעים בו כלל.

### חוזי הקונפיגורציה שנבדקו

- `GET /api/config` — קריאת הקונפיגורציה הנוכחית (מנורמלת גם ל־`{config:{...}}`
  וגם לאובייקט חשוף).
- `PUT /api/config` עם `{config:{...}, profile:'default'}` — **deep-merge** בצד
  השרת. נשלח רק ה־delta; מפתחות שלא נגענו בהם נשמרים. deep-merge אינו יכול
  למחוק מפתח, ולכן שחזור personality קודם נעשה בכתיבת הערך הקודם המדויק.
- `approvals.mode` = `manual|smart|off`, `approvals.cron_mode` = `deny|approve`,
  `delegation.subagent_auto_approve` = bool. מצב שותף מקבע `manual` + `deny` +
  `subagent_auto_approve=false`.
- `GET /api/tools/terminal/backends` ו־`PUT /api/tools/terminal/backend {backend}`.
- שדות Docker: `terminal.backend`, `docker_volumes` (רשימת `host:container[:ro]`),
  `docker_mount_cwd_to_workspace=false`, `docker_network=false` כברירת מחדל
  בטוחה, `docker_forward_env=[]`, ובנוסף `docker_image/resources/lifecycle`
  שנשארים בברירת המחדל.

### Personality נייטיב רשמי

מצב שותף משתמש ב־`personalities.business-partner` (Personality בעל שם) וב־
`display.personality` בלבד. ההפעלה שומרת פעם אחת את `display.personality` הקודם
המדויק (idempotent — לא משכתבים את הערך המוזרק שלנו), וכיבוי משחזר אותו. הגדרת
ה־Personality עצמה נשארת בקונפיג (לא מזיקה כשאינה פעילה). ה־prompt קטן בכוונה;
ההתנהגות המפורטת חיה ב־Skill.

### Skill מותקן ונראה ב־Hermes המלא

`hermes-plugin/business-partner/SKILL.md` מותקן אל
`<hermesHome>/skills/business/business-partner/SKILL.md` עם receipt של integrity
(idempotent), ונראה במסך ה־Skills המלא. הוא מגדיר: יזום, אתגור, מחקר, הצעות,
צוותי `delegate_task` נייטיביים, וגבול קשיח — לעולם לא לשלוח/להוציא כסף/לפרסם/
למחוק/לבצע commit/לשנות הרשאות/להתחייב חיצונית בלי אישור מפורש. צ׳ק־אין יזום
הוא משימת cron רשמית אחת שנוצרת רק לאחר הפעלה מפורשת של המשתמש (ראה למטה).

### שלוש רמות ארגז חול — והאמת עליהן

- **off** — backend מקומי, ללא הגבלת נתיב כתיבה. אישור ידני הוא ההגנה היחידה.
- **guard** — backend מקומי + הזרקת `HERMES_WRITE_SAFE_ROOT` בזמן עליית ה־Runtime.
  מאומת מול `agent/file_safety.py` (`get_safe_write_roots` + `is_write_denied`):
  המשתנה נקרא במקום **אחד בלבד** ומגביל **רק** את כלי הכתיבה
  (`write_file`/`patch`/`delete`/`move`) — **לא** קריאות, **לא** טרמינל/שֶׁל, ולא
  רשת (הטרמינל אינו מתייעץ בו כלל, כך שֶׁל `echo > /path` אינו כלוא). Hermes מריץ
  `os.path.realpath` על היעד ועל השורשים, ולכן ניסיון בריחה עם `..` או symlink
  **נחסם** על ידי Hermes עצמו. ריבוי נתיבי כתיבה תקינים מחוברים ב־path delimiter.
  **כשל־פתוח מובנֶה ב־Hermes ותיקונו אצלנו:** כאשר ה־env ריק/חסר, Hermes **אינו**
  מגביל כתיבה כלל (fail-open), ואין ב־Hermes בדיקה שהשורש אינו `/` (שורש כזה = היתר
  לכל). לכן שכבת השותף מאמתת שורשים לפני החלה (`electron/sandbox-roots.cjs`):
  נתיב חייב להיות מוחלט, ללא `..`, לא שורש כונן/מערכת, וקיים כספרייה (עברית ורווחים
  תקינים). שורש כתיבה שנבחר והתגלה כלא־תקין **נכשל־סגור**: `planSandbox` זורק **לפני
  כל כתיבה** ואינו מחיל דבר (שום דבר לא נשמר). **כשל־סגור מלא ב־guard:** כל תצורת
  guard שמניבה **אפס** נתיבי כתיבה תקינים — בין אם לא נבחרה תיקיה כלל, נבחרו רק
  תיקיות קריאה, או שכל נתיבי הכתיבה שנבחרו לא־תקינים — מזריקה ב־spawn `HERMES_WRITE_SAFE_ROOT`
  = **sentinel של דחיית־כל** (`business/.partner-no-write`, נתיב שאיש אינו נמצא תחתיו),
  ולעולם **לא** `null`. Hermes אז חוסם כל כתיבה של כלי־קבצים עד שהבעלים בוחר תיקיית
  כתיבה אמיתית — במקום ליפול ל“ללא גבול” (שאותו Hermes מפרש כהיתר־לכל). ה־UI מציג את
  נתיב הכתיבה הבטוח בפועל, וה־copy מדגיש ש־guard **אינו ארגז חול מלא**: הוא חל רק על
  כלי הקבצים של Hermes ואינו חוסם קריאות, כתיבה דרך הטרמינל (shell) או רשת.
- **docker** — backend `docker` עם `docker_volumes` מהתיקיות שנבחרו. נדרש
  `status==='ready'` מ־`/api/tools/terminal/backends`. אם Docker חסר/עצור/לא
  זמין — **fail-closed**: המערכת אינה מפעילה Docker, חוזרת ל־local+guard,
  ומדווחת מפורשות שאין בידוד (degraded).

**דיוק קריטי:** Docker אינו תמיד עוקף אישורים. הוא מדלג על שכבת פקודות מסוכנות
רק כאשר אין bind של נתיב host. תיקיות `docker_volumes` מ־host או `mount_cwd`
אוטומטי מחזירים את מלוא שכבת ה־guard של `terminal/execute_code`. כתיבה
(`write_file/patch`) בתוך mount לכתיבה מסתמכת על שמירת נתיבים רגישים חלשה יותר —
ולכן `:ro` היא ההגנה החזקה ביותר. מסך התמיכה מציג את המשמעות המדויקת לכל מצב.

### סמנטיקת אישורים מאומתת (מקור Hermes)

נבדק ישירות בקוד ולא בתיעוד:

- `approvals.mode` (`tools/approval.py`) הוא שער לפקודות **שֶׁל/exec מסוכנות בלבד**
  (denylist מבוסס regex) ול־`execute_code`/MCP elicitations — הוא **אינו** גבול
  קבצים או רשת. `manual` מבקש אישור אינטראקטיבי בסשן החי; `off` עוקף (למעט
  ה־hardline floor). מצב שותף מקבע `manual`.
- `approvals.cron_mode` חל **רק** על סשני cron (`HERMES_CRON_SESSION=1`,
  `cron/scheduler.py`). `deny` (ברירת המחדל, ומצב שותף מקבע אותה) חוסם **רק** פקודות
  מסוכנות ו־`execute_code` בריצה לא־מלווה; פקודות רגילות/בטוחות ממשיכות לרוץ. אין מצב
  ביניים של “הַמְתֵּן לאישור אנושי” ל־cron, ולכן `deny` הוא ההגדרה הבטוחה שעדיין
  מאפשרת לצ׳ק־אין לעבוד. **מסקנה מפורשת:** `cron_mode: deny` **אינו** הופך צ׳ק־אין
  לבלתי־אפשרי — הוא רק מבטיח שצ׳ק־אין חוקר ומנסח, ולעולם אינו מבצע פעולה הרסנית ללא
  אדם נוכח. לכן אנו שומרים `deny` ולא מרפים אותו.

הערת גרסה כנה: עץ המקור שנבדק ב־`C:\projects\hermes-agent` מדווח
`__version__ = "0.17.0"` (snapshot פיתוח, ללא tags), בעוד ההתקנה החיה של המוצר היא
`0.19.1`. החוזים שעליהם נשענת שכבת השותף — `/api/cron/jobs` (ב־`hermes_cli/
web_server.py`, `CronJobCreate`/pause/resume/PUT), סמנטיקת `cron_mode`, ואופי
ה־write-only של `HERMES_WRITE_SAFE_ROOT` — זהים בשני העצים ומאומתים חיים מול
`0.19.1` דרך ה־probes הקיימים.

הבחנת גרסה קריטית ל־Desktop Plugin SDK: ה־checkout ה**ישן** ב־
`C:\projects\hermes-agent` (`0.17.0`) **אינו** כולל `@hermes/plugin-sdk` או את
ה־runtime disk-plugin loader — ולכן ביקורת מוקדמת שהסתמכה עליו הסיקה בטעות
ש"אין SDK". זו הייתה טעות. ההתקנה/היעד האמיתי — Hermes `0.19.1` תחת
`%LOCALAPPDATA%\hermes\hermes-agent` (upstream `NousResearch/hermes-agent`) —
**כן** מספק את `@hermes/plugin-sdk` (`apps/desktop/src/sdk/index.ts` מייצא כל
סמל שה־Plugin מייבא) ואת ה־runtime loader האמיתי
(`apps/desktop/src/contrib/runtime-loader.ts`) שדלתו היא
`<hermes home>/desktop-plugins/<name>/plugin.js` — בדיוק היכן ש־
`BusinessInstall.ps1` מתקין. לכן ה־Desktop Plugin הוא **אמיתי**, וה־SDK **קיים**.
`verify:plugin` מאמת זאת מול המקור המותקן, ולעולם אין לטעון "אין SDK".

### צ׳ק־אין מתוזמן — משימת cron רשמית אחת, מסונכרנת אידמפוטנטית

צ׳ק־אין הוא **אופציה בהצטרפות מפורשת** (checkbox + בורר תדירות). כשמפעילים אותו,
שכבת השותף יוצרת ומסנכרנת **משימת cron רשמית אחת** מול אותו scheduler יחיד של
Hermes (`/api/cron/jobs`). **אין scheduler מקביל ואין cache** — ההגדרות המקומיות
שומרות רק את הכוונה (הצטרפות + תדירות); לוח הזמנים הסמכותי הוא המשימה הרשמית, נראית
גם ב־Hermes המלא וגם ב־UI הפשוט.

- **סמן בעלות יציב.** חוזה ה־REST `CronJobCreate` **אינו** מקבל שדה `origin`/מטא־דאטה
  שרירותי (`web_server.py:8192`), ולכן מזהה הבעלות נטוע ב־**שם** המשימה כאסימון יציב
  `[hermes-business-partner-checkin:brief:<תדירות>]`. סנכרון נוגע **אך ורק** במשימות
  הנושאות את הסמן — משימות שהמשתמש יצר בעצמו לעולם אינן נוצרות־שוב, נערכות, מושהות או
  נמחקות.
- **אידמפוטנטי.** הסנכרון רץ ב־startup (`main.cjs`) ובכל שינוי הגדרות
  (`applyPartnerMode`): הצטרפות → מוודא בדיוק משימה מסומנת אחת (יוצר אם חסרה, מחדש אם
  מושהית, מעדכן אם ה־cadence/שם/prompt סטו, ומכנס כפילויות משלנו לאחת). הרצה חוזרת
  מתכנסת ללא churn.
- **סמנטיקת כיבוי מפורשת ושמרנית.** ביטול ההצטרפות **משהה** את המשימה (נשמרת, עדיין
  נראית עם pill “מושהה”, מתחדשת בהפעלה חוזרת) — לעולם לא מוחקת, כדי לשמר את בחירת
  המשתמש. משתמשים לעולם אינם מאבדים משימות משלהם.
- **התוכן כן.** ה־prompt של הצ׳ק־אין מצהיר שהריצה לא־מלווה: Hermes חוסם פקודות
  מסוכנות ו־`execute_code` תחת cron, ולכן הצ׳ק־אין רק חוקר, מנתח ומנסח תדריך קצר —
  לעולם אינו שולח/מוציא כסף/מפרסם/מוחק/מבצע commit.
- **תדירות ואזור זמן (מאומת מהמקור).** שבוע העבודה הישראלי הוא **ראשון–חמישי**, ולכן
  `weekdays` = `0 8 * * 0-4` (croniter תקני: `0`=ראשון, כך ש־`0-4` הוא א׳–ה׳, **לא**
  `1-5` שהוא ב׳–ו׳ המערבי). `weekly` יורה בראשון (`0`), `daily` בכל יום. Hermes מעריך
  את היום/שעה ב־**אזור הזמן המוגדר**: `hermes_time.now()` פותר `HERMES_TIMEZONE` →
  מפתח `timezone` ב־`config.yaml` → שעון המכונה (`cron/jobs.compute_next_run` מריץ את
  croniter על שעון זה). חוזה ה־`CronJobCreate`/`Update` הרשמי **אינו** נושא שדה אזור־זמן
  לכל משימה, ולכן איננו ממציאים כזה — בעל עסק ישראלי יגדיר `timezone: Asia/Jerusalem`
  (או `HERMES_TIMEZONE`) פעם אחת והצ׳ק־אין ירוץ על אותו שעון קיר.
- **כיבוי אמין (ללא הצלחה מדומה).** אם סנכרון הכיבוי (pause) נכשל, ה־API **אינו**
  מדווח הצלחה: `applyPartnerMode` מחזיר `checkin.error`, השכבה הקדמית זורקת שגיאה
  גלויה, ו־`getPartnerState.checkinMismatch` ממשיך להציג את הפער (משימה עדיין פעילה
  למרות כיבוי) עד שסנכרון ה־startup האידמפוטנטי מכנס אותה. הכוונה נשמרת, המשימות של
  המשתמש לעולם אינן נוגעות, וה־store הרשמי היחיד נשאר מקור־יחיד.

מודולים: `electron/partner-checkins.cjs` (לוגיקת סנכרון טהורה + סמן),
`electron/partner-cron.cjs` (לקוח REST דק ל־`/api/cron/jobs`). ה־RPC `cron.manage`
נשאר פעיל־בלבד, ולכן משימה מושהית נעלמת ממנו אך נראית דרך ה־REST הכולל־paused ועל
הדיסק — בדיוק מה שמוכיח ה־probe החי `provePartnerCheckinReconcile`.

### הזרקת Runtime והתמדה

הזרקת ה־env היחידה של ארגז החול היא `HERMES_WRITE_SAFE_ROOT`, שנבנית ב־
`electron/runtime.cjs` בזמן `spawn` מתוך ההגדרות העמידות. שינוי שמזיז את הערך
הזה מפעיל restart ממוקד של ה־Runtime המנוהל; שינויים שאינם משנים אותו לא.
ההגדרות נשמרות ב־`<hermesHome>/business/partner-settings.json` (מצב, רמת ארגז חול,
רשת, צ׳ק־אין, תיקיות, ו־`configBackup`).

**גיבוי/שחזור עמיד ו־transaction-safe (`electron/partner-config.cjs`).** מצב שותף
מחזיק **רשימה מפורשת אחת** של שדות ה־config שהוא מחזיק ומשנה (`OWNED_FIELDS`):
`display.personality`, `approvals.mode`, `approvals.cron_mode`,
`delegation.subagent_auto_approve`, `terminal.backend` וארבעת שדות
`terminal.docker_*` (נטועים תחת `terminal` כי שם Hermes קורא אותם —
`config_defaults`/`TERMINAL_DOCKER_VOLUMES`). דבר מחוץ לרשימה אינו נקרא, נכתב או
משוחזר. במעבר normal→partner נלכד **פעם אחת** גיבוי גרסאי שרושם **נוכחות וגם ערך**
של כל שדה; במעבר partner→normal השדות משוחזרים במדויק (present → הערך שנלכד; absent
→ ברירת המחדל התיעודית של Hermes, כי deep-merge אינו יכול למחוק מפתח). כל שלב שנכשל
בהחלה מגלגל אחורה את השלבים שכבר הוחלו (שחזור ה־snapshot שנלכד לפני הכתיבה הראשונה),
ולכן לעולם אין מצב חצי־מוחל בקונפיג או בדיסק. אין מנוע config מתחרה — זהו המקום היחיד.

WhatsApp נשאר כפוף למדיניות read-only/selected הקיימת; מצב שותף אינו מרפה אף
guard קיים ואינו טוען שמשלוח דרך connector מאובטח אם אינו.

### קבצים עיקריים

- `electron/hermes-config.cjs` — עטיפות REST מאומתות (deepMerge/get/put/backends/docker).
- `electron/partner-settings.cjs` — התמדה מקומית + גזירת `HERMES_WRITE_SAFE_ROOT` (כשל־סגור).
- `electron/sandbox-roots.cjs` — אימות שורשים טהור (מוחלט/ללא `..`/לא שורש מערכת/קיים) + sentinel דחיית־כל.
- `electron/partner-mode.cjs` — `applyPersona`: התקנה+בחירה של ה־Personality בלבד (הגיבוי/שחזור עברו ל־partner-config).
- `electron/partner-config.cjs` — גיבוי/שחזור עמיד ו־transaction-safe של שדות ה־config שהפיצ׳ר מחזיק (OWNED_FIELDS).
- `electron/sandbox-config.cjs` — חישוב תוכנית ארגז חול + `planSandbox` (כשל־סגור לפני כתיבה) + `applyResolvedPlan`.
- `electron/partner-checkins.cjs` — סנכרון צ׳ק־אין אידמפוטנטי + סמן בעלות + קריאת מצב חי.
- `electron/partner-cron.cjs` — לקוח REST דק ל־`/api/cron/jobs` (list/create/update/pause/resume/remove).
- `electron/business-partner.cjs` — Orchestrator שה־IPC מפעיל (כולל סנכרון צ׳ק־אין).
- `electron/partner-skill-install.cjs` — התקנת ה־Skill המותקן.
- `src/components/screens/support/SupportPartnerPanel.tsx` + `PartnerStatusRows.tsx`,
  `src/components/PartnerModeSelector.tsx`, `src/hooks/usePartnerMode.ts`,
  `src/lib/partner.ts`.

### בדיקות

- Unit/contract: `electron/hermes-config.test.ts`, `partner-settings.test.ts`,
  `sandbox-roots.test.ts`, `sandbox-config.test.ts`, `partner-checkins.test.ts`,
  `partner-mode.test.ts`, `partner-config.test.ts`, `business-partner.test.ts`.
  מכסים: אימות שורשים כולל נתיבי עברית+רווחים, שורש לא־מוחלט/`..`/שורש־מערכת/חסר,
  **כשל־סגור מלא ל־sentinel דחיית־כל כשאין נתיב כתיבה תקין (אין תיקיות / רק־קריאה /
  לא־תקין)**, גיבוי/שחזור מדויק כולל שדות חסרים, **גלגול אחורה בכל שלב שנכשל** (persona
  ו־backend), **cadence ראשון–חמישי (`0-4`)**, יצירת/עדכון/השהיית/הסרת/התנגשות־בעלות
  של צ׳ק־אין, אידמפוטנטיות, **כיבוי שנכשל אינו מתחזה להצלחה (`checkin.error` +
  `checkinMismatch`)**, restart רק כשה־safe-root משתנה, וסמנטיקת אישורים. כל בדיקה רצה
  תחת `HERMES_HOME` מבודד זמני ואינה נוגעת בפרופיל החי.
- E2E חי ומבודד: `provePartnerCheckinReconcile` (חלק מ־`test:e2e:hermes-shared-state`)
  מריץ את **פונקציית הסנכרון האמיתית** מול Hermes חי ב־home מבודד — יוצר צ׳ק־אין
  מסומן אחד (נראה ב־`cron.manage` ועל הדיסק), מוכיח אידמפוטנטיות, ואז מַשְׁהֶה בביטול
  ההצטרפות (נראה מושהה ב־REST הכולל־paused, מושמט מה־active-only), ומנקה. ה־home
  המבודד נמחק — הפרופיל החי לעולם אינו נוגע.
- Probe מותקן בטוח: `scripts/e2e-installed-partner-ui.mjs`
  (`npm run test:e2e:installed-partner-ui`) — מפעיל שותף, מבקש Docker בזמן שהוא
  עצור, ומוודא fail-closed ל־guard. לעולם אינו מפעיל Docker ואינו משאיר container.
