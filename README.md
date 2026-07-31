# העוזר לעסק — מעטפת עסקית מעל Hermes

POC עובד ל־Windows שמוסיף שתי דרכי שימוש מעל **אותה התקנת Hermes**:

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
- Telegram דרך Messaging API הרשמי של Hermes.
- Skills דרך ה־API הרשמי, כולל יצירת Skill שנראה גם ב־Hermes המלא.
- משימות דרך Cron API הרשמי, בלי לחשוף Cron למשתמש.
- בדיקת תקינות, restart, גרסאות, Logs, עדכון וחבילת אבחון בטוחה.
- פתיחת Hermes Desktop, Dashboard, Logs והגדרות מתקדמות.

## מתקינים

### המוצר המלא

```text
release/העוזר לעסק Setup 0.3.2.exe
```

- גודל: `102,594,498` bytes.
- SHA-256:
  `FD14ED6E33861AA0BA02A97D818F831F471A6AF10E27123ADA40897A3B6AF6EE`
- מתקין per-user אחד הכולל את ה־Companion.
- בהפעלה ראשונה מזהה Hermes, ובמידת הצורך מפעיל את ה־bootstrap הרשמי.
- מתקין את ה־Plugin ואת `business-bootstrap`, ומפעיל Gateway ברקע.
- יוצר קיצורי Desktop ו־Start Menu עם אייקון המוצר.

### מתקין רשת זעיר

```text
release/Hermes-Business-Web-Setup-0.3.2.exe
```

- גודל: `108,285` bytes.
- SHA-256:
  `6739B8EF226D5C18A6A4ED7E05C27B4749ED315249F528ACAA2C637A2AE352F9`
- אינו אורז Hermes או Chromium.
- בוחר את ה־release הרשמי החדש ביותר בטווח התאימות `>=0.19.0 <0.20.0`.
- מתקין Hermes Desktop, את ה־Plugin ואת ה־Skill, ומבצע Gateway health check.

המתקין הזעיר מספק כרגע את חוויית ה־Plugin בתוך Hermes Desktop. כדי שגם הוא
יוריד את ה־Companion הקטן נדרש לפרסם build חתום ב־release URL יציב; אין ב־POC
כתובת הורדה מומצאת או לא חתומה.

שני ה־builds הם POC ללא code-signing, ולכן Windows עשוי להציג SmartScreen.

## הפעלה ופיתוח

```powershell
npm install
npm test
npm run verify:plugin
npm run verify:bootstrap
npm run build
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

- `17/17` בדיקות עברו.
- TypeScript/Vite build, Plugin contract ו־bootstrap resolver עברו.
- המתקין המלא והמתקין הזעיר הותקנו בשקט עם exit code `0`.
- האפליקציה המותקנת עברה E2E מול Hermes חי ללא console/page errors.
- שאלה מובנית של הסוכן הוצגה ונענתה דרך RPC הרשמי.
- אישור לפקודה מסוכנת נדחה והפעולה לא בוצעה.
- Session מהחלון הקטן נמצא מיד דרך `session.list`.
- Skill נוצר ונמצא דרך `/api/skills`.
- משימה נוצרה, הושהתה, נמצאה דרך Cron API ונמחקה לאחר ההוכחה.
- חבילת האבחון הכילה רק `README.txt` ו־`diagnostics.json`.
- Gateway עבר את כל ששת ה־deep probes ומצב האישורים הוחזר ל־`smart`.

## גבולות שדורשים את המשתמש

- Google Workspace זמין, אך OAuth אינו מחובר במחשב הבדיקה. נדרש
  `client_secret.json` של Google Cloud והסכמה בדפדפן.
- Telegram זמין, אך אינו מוגדר. נדרשים Bot Token ו־allowed user ID.
- לא נשמרו credentials מומצאים ולא נעקף מסך הסכמה.
- עדכון Hermes זוהה ונבדק, אך לא הוחל בכוח על checkout פעיל עם שינויים.
