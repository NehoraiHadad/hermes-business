# העוזר לעסק — מעטפת עסקית מעל Hermes

MVP/Alpha מקומי ל־Windows (מוכן לפיילוט, אך עדיין לא production) שמוסיף שתי דרכי
שימוש מעל **אותה התקנת Hermes**:

- Companion קטן וזמין על שולחן העבודה, עם צ׳אט, מזעור, הצמדה ו־Tray.
- Desktop Plugin ידידותי בתוך Hermes המלא.

אין כאן Agent Runtime, Memory, Scheduler, Skill Engine או Connector חלופיים.
שתי התצוגות משתמשות באותו Profile, Sessions, Memory, Skills, חיבורים,
משימות והגדרות של Hermes.

המחקר והחוזים שנבדקו מתועדים ב־[docs/hermes-integration.md](docs/hermes-integration.md).

## מה עובד

- זיהוי או התקנת Hermes תואם ללא Terminal.
- Provider דרך מנגנון ההגדרה של Hermes; OpenAI Codex OAuth נבדק בפועל.
- onboarding שמתחיל Skill אמיתי בשם `business-bootstrap`.
- הסוכן שואל שאלות דרך `clarify.request`; התשובה חוזרת ב־`clarify.respond`.
- רשימת Sessions משותפת וחיפוש בסיסי.
- Streaming, Stop, קבצים מצורפים ופעילות כלי בשפה פשוטה.
- אישורים דרך `approval.request` / `approval.respond`, כולל דחייה שנבדקה בפועל.
- Google Workspace דרך ה־Skill הרשמי של Hermes.
- Telegram דרך Messaging API הרשמי של Hermes; בוט ייעודי עבר הודעה אמיתית
  הלוך־ושוב והשיחה הופיעה גם ב־Hermes Desktop המלא.
- WhatsApp בשני המסלולים בשקיפות: Meta Cloud הרשמי כברירת המחדל העסקית,
  ו־WhatsApp Web/QR של Hermes כחלופה לא־רשמית.
- מדיניות מענה fail-closed ל־WhatsApp (קריאה־בלבד או צ׳אטים נבחרים), נאכפת ב־plugin
  `business-whatsapp-policy` דרך `pre_gateway_dispatch` ו־guards על ה־platform
  registry — לא רק ב־UI. ברירת מחדל: קריאה בלבד. הודעות נשמרות ל־session store גם
  במצב קריאה־בלבד, בלי שהסוכן ירוץ. אותה מדיניות וסנכרון allowlist חלים על שני
  המתאמים.
- Skills דרך ה־API הרשמי, כולל יצירת Skill שנראה גם ב־Hermes המלא.
- משימות דרך Cron API הרשמי, בלי לחשוף Cron למשתמש.
- בדיקת תקינות, restart, גרסאות, Logs, עדכון וחבילת אבחון בטוחה.
- פתיחת Hermes Desktop, Dashboard, Logs והגדרות מתקדמות.

## מתקינים

### המוצר המלא

```text
release/העוזר לעסק Setup 0.3.3.exe
```

- גודל: `102,669,826` bytes.
- SHA-256:
  `5529B70A90CCF71F98A9E6B62A37ED8EEB766CC0EA3CE36A85118592569591B0`
- מתקין per-user אחד הכולל את ה־Companion.
- בהפעלה ראשונה מזהה Hermes, ובמידת הצורך מפעיל את ה־bootstrap הרשמי.
- מתקין את ה־Plugin ואת `business-bootstrap`, ומפעיל Gateway ברקע.
- יוצר קיצורי Desktop ו־Start Menu עם אייקון המוצר.

### מתקין רשת זעיר — מנגנון מוכן, artifact לפרסום עדיין לא סופי

```text
release/Hermes-Business-Web-Setup-0.3.3.exe
```

- אינו אורז Hermes או Chromium.
- בוחר את ה־release הרשמי החדש ביותר בטווח התאימות `>=0.19.0 <0.20.0`.
- מתקין Hermes Desktop, את ה־Plugin ואת ה־Skill, מוריד Companion לפי manifest
  עם checksum מסוג SHA-256, ומבצע Gateway health check.

המסלול כולו עבר E2E מול שרת loopback: הורדת manifest, אימות ה־checksum (SHA-256)
והתקנה שקטה של ה־Companion. חשוב לדייק: SHA-256 הוא checksum לאימות שלמות הקובץ,
ולא חתימה קריפטוגרפית — ה־manifest אינו חתום. הקובץ הקיים תחת `release/` אינו
artifact הפצה סופי, משום שעדיין אין `COMPANION_MANIFEST_URL` ציבורי ויציב ב־HTTPS,
ואין עדיין code-signing.

שני ה־builds אינם חתומים (ללא code-signing), ולכן Windows עשוי להציג SmartScreen.

## מה עדיין חסר ל־production (Production gates)

זהו MVP/Alpha מקומי מוכן לפיילוט, לא מוצר production. השערים שנותרו:

- **Google OAuth consent אמיתי** — אישור OAuth מאומת ומאושר (לא test/loopback בלבד).
- **Companion manifest ציבורי ויציב ב־HTTPS** — כתובת `COMPANION_MANIFEST_URL`
  קבועה, לא רק שרת loopback ל־E2E.
- **Code signing** — חתימת המתקין וה־Companion (וה־manifest עצמו), כדי להסיר
  SmartScreen ולספק אמון הפצה. כיום קיים רק אימות checksum, ללא חתימה.
- **שליחת WhatsApp חיה לצ׳אטים נבחרים בבידוד** — מסלול Cloud out-of-process חי
  ומבודד. כיום שליחת Cloud מתבצעת רק בתוך ה־Gateway הפעיל (in-process); ראו
  [docs/hermes-integration.md](docs/hermes-integration.md).
- **מטריצת שדרוג מלאה** — כיסוי שדרוג מלא בכל שיטות ההתקנה (git/pip/pipx) וגרסאות
  לרוחב טווח התאימות `>=0.19.0 <0.20.0`.

## סרטון תדמית

הפקת Remotion מלאה נמצאת תחת `promo-video/`. הסרטון הסופי:

```text
promo-video/out/hermes-business-promo.mp4
```

55.06 שניות, ‎1920×1080, ‏30fps, ‏H.264 + AAC. ה־render נבנה עם Remotion
`4.0.503`, עבר TypeScript, ‏`npm audit` ללא חולשות, ffprobe ובדיקת contact sheet.

## הפעלה ופיתוח

```powershell
npm install
npm test
npm run test:plugin:policy
npm run verify:plugin
npm run verify:bootstrap
npm run build
npm run test:e2e:bootstrap-companion
npm run test:e2e:bootstrap-clean
npm run test:e2e:missing-hermes-ui
npm run test:e2e:hermes
npm run test:e2e:installed-ui
npm run package:win
npm run package:bootstrap
```

ה־Plugin נכתב כמקור מודולרי תחת:

```text
hermes-plugin/business-shell/src/
```

`npm run build:plugin` מייצר ממנו artifact יחיד:

```text
hermes-plugin/business-shell/plugin.js
```

זהו קובץ generated שה־loader של Hermes דורש. `verify:plugin` נכשל אם ה־artifact
אינו תואם למקור, ולכן מתקין לא יכול לארוז Plugin ישן בשקט.

קוד המוצר מחולק לפי גבולות אחריות:

```text
src/components/    מסכים, צ׳אט, onboarding, דיאלוגים ורכיבי UI
src/hooks/         תזמור Session, נתוני Hermes ומצב חלון
src/lib/hermes/    RPC, REST, demo transport והתאמות חוזה
src/styles/        CSS לפי רכיב ומסך
electron/          runtime, IPC, חלונות, אבחון, Google ו־plugin install
```

## תוצאות קבלה מקומיות

נבדקו מול Hermes Agent `0.19.0`; resolver המתקין מצא גם release רשמי תואם
`0.19.1` (`v2026.7.30`).

- `63/63` בדיקות Vitest ו־`17/17` בדיקות plugin עברו.
- TypeScript/Vite build, Plugin contract, bootstrap resolver ואימות Git blob של
  המתקין הרשמי עברו.
- המתקין המלא והמתקין הזעיר הותקנו בשקט עם exit code `0`.
- האפליקציה המותקנת עברה E2E מול Hermes חי ללא console/page errors.
- מסך WhatsApp המותקן עבר E2E: ברירת מחדל read-only, מעבר לצ׳אטים נבחרים,
  סנכרון להגדרות Hermes, חזרה ל־read-only ויצירת QR אמיתי.
- בוט Telegram ייעודי עבר הודעה אמיתית הלוך־ושוב דרך ה־Gateway; ה־session
  המשותף נפתח גם ב־Hermes Desktop המלא.
- שאלה מובנית של הסוכן הוצגה ונענתה דרך RPC הרשמי.
- `session.resume` החזיר את אותו transcript; `tool.start/tool.complete` התקבלו עם
  אותו tool id, ו־`session.interrupt` עצר תשובת Streaming פעילה.
- אישור לפקודה מסוכנת נדחה והפעולה לא בוצעה.
- Session מהחלון הקטן נמצא מיד דרך `session.list`.
- Skill נוצר ונמצא דרך `/api/skills`.
- משימה נוצרה, הושהתה, נמצאה דרך Cron API ונמחקה לאחר ההוכחה.
- חבילת האבחון הכילה רק `README.txt` ו־`diagnostics.json`.
- Gateway עבר את כל ששת ה־deep probes ומצב האישורים הוחזר ל־`smart`.

## גבולות שדורשים את המשתמש

- Google Workspace זמין, אך OAuth אינו מחובר במחשב הבדיקה. נדרש
  `client_secret.json` של Google Cloud והסכמה בדפדפן.
- לא נשמרו credentials מומצאים ולא נעקף מסך הסכמה.
- חיבור WhatsApp Web נסרק בפועל. הודעה נכנסת נשמרה ב־Session המשותף ונחסמה לפני
  dispatch במצב read-only: ללא inference, ללא Tool Calls וללא outbound delivery.
- עדכון Hermes אמיתי עבר דרך המעטפת מ־`0.19.0` ל־`0.19.1`: Hermes Desktop,
  ה־gateway וה־runtime נסגרו באופן מבוקר, updater הרשמי רץ, Health Check עבר,
  ו־70 Sessions, ‏64 Skills והמשימות נשמרו לפני ואחרי.
- Meta Coexistence הוא המסלול הרשמי המתאים למספר שכבר פעיל ב־WhatsApp
  Business App, אך Hermes `0.19.x` עדיין אינו מממש Embedded Signup או את
  אירועי הסנכרון שלו. הוא אינו מוצג במוצר כאילו הוא זמין.
