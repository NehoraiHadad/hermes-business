# העוזר לעסק — POC מעל Hermes

מעטפת עסקית פשוטה שרצה **בתוך Hermes Desktop** באמצעות `@hermes/plugin-sdk`.

ה־POC אינו מריץ Agent Runtime חדש ואינו משכפל Chat, Sessions, Streaming, Approvals, Skills, Memory, Scheduler או Connectors. הוא מוסיף עמוד “לעסק” מעל אותה התקנת Hermes.

## מה כלול

- עמוד בית עסקי בתוך Hermes Desktop;
- מצב “צ׳אט קטן” בגודל widget, עם הצמדה מעל חלונות, הרחבה והסתרה ל־Tray;
- מיתוג ידידותי כ־“העוזר שלי”, עם קרדיט מצומצם “מופעל באמצעות Hermes”;
- onboarding למשתמש ולעסק, שנשמר דרך Session רגיל ב־Memory וב־Skill;
- קיצורי דרך ל־Chat, Sessions, Artifacts, Skills ו־Hermes המלא;
- מצב Provider וחיבור דרך המסך הרשמי;
- Google Workspace דרך ה־Skill הרשמי;
- Telegram דרך Messaging של Hermes;
- הסבר שקוף על WhatsApp רשמי לעומת Baileys;
- יצירה והצגה של Scheduled Tasks דרך `cron.manage`;
- health, version, restart ו־logs דרך ה־SDK;
- ZIP אבחון מקומי ומצומצם ב־launcher, עם allowlist טכני וללא raw logs,
  תוכן שיחות או קבצי עסק;
- הודעות פעילות פשוטות מעל אירועי `tool.*`;
- הודעה כאשר Hermes יוצר/משפר Skill.

המחקר והחלטת הארכיטקטורה נמצאים ב־[docs/hermes-integration.md](docs/hermes-integration.md).

## התקנת ה־POC

דרישות:

- Hermes Agent עדכני;
- Hermes Desktop עם `@hermes/plugin-sdk`;
- Node.js 20 ומעלה עבור סקריפט ההתקנה של ה־POC בלבד.

```powershell
npm run verify:plugin
npm run install:plugin
hermes desktop
```

לאחר הפתיחה, בחר “לעסק” בסרגל הצד. Hermes טוען את ה־plugin מחדש אוטומטית כאשר `plugin.js` משתנה.

`HERMES_HOME` ו־`HERMES_PROFILE` נתמכים על ידי סקריפט ההתקנה. ב־Windows ברירת המחדל היא:

```text
%LOCALAPPDATA%\hermes\desktop-plugins\business-shell\plugin.js
```

### מתקין רשת רזה

למחשב של לקוח מומלץ להתחיל מהמתקין הזעיר:

```text
release/Hermes-Business-Web-Setup-0.3.0.exe
```

גודל הקובץ כ־91KB בלבד. הוא אינו אורז עותק של Hermes או Chromium. הוא מזהה
התקנת Hermes תואמת, ואם אינה קיימת מוריד את סקריפט ההתקנה הרשמי מגרסה מתויגת
של `NousResearch/hermes-agent`, מתקין את ה־Desktop Plugin ואת
`business-bootstrap`, מפעיל את ה־Gateway ברקע, מבצע Health Check ופותח את
Hermes Desktop. Profile, Sessions, Memory, Skills ו־Cron קיימים אינם נמחקים.

ה־bootstrapper תומך כרגע בטווח שנבדק `>=0.19.0 <0.20.0`; גרסה מחוץ לטווח
נעצרת עם הודעת תאימות במקום לבצע שדרוג עיוור.

### Windows Installer

נבנה Installer יחיד:

```text
release/העוזר לעסק Setup 0.3.0.exe
```

בפתיחה הראשונה ה־bootstrapper:

1. מזהה או מתקין את Hermes באמצעות המתקין הרשמי;
2. מתקין את `business-shell` תחת Hermes Home;
3. יוצר receipt עם SHA-256;
4. מתקין ומפעיל את `hermes gateway` כרקע עבור Cron וערוצי הודעות;
5. מאפשר לפתוח את Hermes Desktop המלא.

ב־Windows Hermes מנסה Scheduled Task. אם המשתמש אינו מאשר UAC, הוא משתמש
ב־Startup-folder login item הרשמי שלו.

זהו build של POC ללא code-signing. Windows עשוי להציג אזהרת SmartScreen; release אמיתי צריך certificate וחתימה.

### מצב צ׳אט קטן

מהחלון המלא בוחרים **“צ׳אט קטן”**. החלון עובר ל־widget קומפקטי בפינת
המסך וממשיך להשתמש באותו Session ובאותו Hermes Runtime. אפשר:

- להצמיד או לבטל הצמדה מעל חלונות אחרים;
- לפתוח שיחה חדשה;
- לחזור לחלון המלא;
- להסתיר את העוזר ל־system tray;
- להחזיר אותו דרך אייקון ה־tray או דרך קיצור הדרך של האפליקציה.

סגירת החלון מסתירה אותו ואינה מכבה את העוזר. יציאה מלאה זמינה מתפריט
ה־Tray. העדפת mini/full והצמדה נשמרת כ־UI preference בלבד; שיחות, Memory,
Skills ומשימות ממשיכים להישמר רק ב־Hermes.

ה־Installer נבדק בפועל במסלול per-user: התקנה, הפעלה, טעינת ה־state האמיתי
של Hermes וסגירה נקייה ללא process יתום על port 9119. ה־launcher אינו מציג
עוד שיחות, משימות, Skills או חיבורים מדומים.

`debug-share` הרשמי של Hermes אינו מופעל אוטומטית: הוא אמנם מסיר secrets, אך
עשוי לכלול logs ו־PII. ה־ZIP המצומצם של ה־launcher נבנה בנפרד מ־allowlist
של גרסאות ומצבי runtime בלבד; raw logs אינם מצורפים.

## מבנה

```text
hermes-plugin/business-shell/plugin.js  ה־Desktop Plugin הראשי
hermes-plugin/business-shell/skills/    אשף ההקמה המונחה כסביבת Skill
scripts/install-plugin.mjs              התקנה ל־Hermes Home הפעיל
scripts/verify-plugin.mjs               בדיקות חוזה וייבוא
installer/bootstrap.ps1                 התקנה/זיהוי/Health ללא Runtime חלופי
installer/business-bootstrap.nsi        מעטפת NSIS זעירה למתקין הרשת
docs/hermes-integration.md              מחקר, APIs והחלטות
src/ + electron/                        Companion אופציונלי לחלון Mini תמיד־זמין
```

## בדיקות

```powershell
npm run verify:plugin
npm install
npm test
npm run build
npm run package:bootstrap
npm run package:win
npm run test:e2e:hermes
```

בדיקת הקבלה המקומית עם Hermes `0.19.0` כללה גם Desktop אמיתי, חיבור JSON-RPC
ב־WebSocket, inference אמיתי עם OpenAI Codex, Streaming, Session משותף,
attachment, Stop, אישור פעולה, מחזור מלא של Scheduled Task
(create/pause/resume/remove), הפעלת Cron דרך Gateway רקע, ויצירה/גילוי של
`business-context` Skill. Google Workspace ו־Telegram דורשים credentials
חיצוניים של המשתמש ואינם מסומנים כמחוברים לפני שנמסרו.

גם יצירת ZIP אבחון נבדקה דרך ה־UI. הקובץ כולל רק `diagnostics.json`
ו־`README.txt`, ללא raw logs, שיחות, מיילים, קבצי עסק או secrets.

הבדיקה הראשונה אינה דורשת התקנת dependencies. היא בודקת שה־plugin:

- מייבא רק את ה־SDK הרשמי;
- אינו כולל JSX, משום ש־disk plugin נטען כ־ESM לא מקומפל;
- רושם route ו־sidebar contribution;
- אינו מייבא internals של Hermes, Node או Electron.

## הערה על ה־Thin Client

`src/` ו־`electron/` מתעדים את החלופה שנבדקה לפני גילוי ה־Desktop Plugin SDK. הם אינם הארכיטקטורה המומלצת ואינם נדרשים להפעלת ה־plugin. הם נשמרו כ־fallback אם סביבת יעד ישנה אינה כוללת את ה־SDK.
