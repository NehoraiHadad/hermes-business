# אינטגרציית Hermes — ממצאי מחקר והחלטת ארכיטקטורה

עודכן: 30 ביולי 2026  
גרסת המקור במחקר הראשוני: `NousResearch/hermes-agent@8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281`  
ראש `origin/main` שנבדק מחדש: `4a798f4bce29302c9e981c877753e083f80fe533`  
גרסה שהותקנה ונבדקה בפועל: Hermes Agent `0.19.0` (`2026.7.20`), commit `07447bd5dbd291389438c19586780b7f7fe67c66`

## מסקנה

ה־POC צריך להיות **Hermes Desktop Plugin**, לא Runtime חדש ולא Desktop Client מקביל.

בגרסה שנבדקה, Hermes Desktop כולל SDK רשמי בשם `@hermes/plugin-sdk`. ה־SDK מאפשר להוסיף ל־Desktop:

- עמודים מלאים וניווט צד;
- panes, status bar, title bar ופקודות palette;
- הרחבות ל־composer וקבצים מצורפים;
- רכיבי UI ועיצוב מקוריים של Hermes;
- קריאת state חי של ה־gateway, ה־profile, המודל וה־session;
- גישה ל־JSON-RPC הרשמי באמצעות `host.request`;
- האזנה לזרם האירועים באמצעות `host.onEvent`;
- status, logs והפעלה מחדש של ה־gateway.

Plugin כזה נטען מתוך `$HERMES_HOME/desktop-plugins/<id>/plugin.js`, ללא fork וללא build של Hermes. הוא פועל בתוך Hermes Desktop ולכן משתמש אוטומטית באותו Profile, Sessions, Memory, Skills, Connectors, Cron והגדרות.

המקור העדכני: [Desktop Plugin SDK](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/desktop-plugin-sdk.md).

## האם Hermes מספק UI דינמי?

כן, בשלוש שכבות שונות:

1. **Desktop Plugin SDK** — תשתית דינמית להוספת מסכים ורכיבים ל־Hermes Desktop. זו השכבה הנכונה למעטפת העסקית.
2. **Chat renderers מובנים** — Hermes Desktop מציג Streaming, Tool Calls, Clarify, Approval, Sudo ו־Secret לפי אירועי ה־gateway הרשמיים. אין לבנות להם state machine מקביל.
3. **Artifacts ו־Preview** — תשובות הכוללות HTML, SVG או קוד משמעותי מקודמות לכרטיסי Artifact ול־preview. הכלים `open_preview` ו־`focus_pane` מאפשרים לסוכן לפתוח תוצר או למקד pane ב־Desktop.

לא נמצא חוזה כללי מסוג A2UI/GenUI שבו המודל שולח JSON שרירותי והלקוח ממציא widget חדש לכל תשובה. לכן:

- מסכי המוצר הקבועים נבנים כ־Desktop Plugin;
- פעילות הסוכן ואישורים נשארים ב־Chat המקורי;
- תוצרים עשירים משתמשים ב־Artifacts וב־Preview;
- אין להמציא פרוטוקול UI רביעי.

מקורות: [Artifact detection](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/apps/desktop/src/lib/artifact-detect.ts), [desktop UI bridge](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/tools/desktop_ui.py), [Desktop user guide](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/website/docs/user-guide/desktop.md).

## אפשרויות UI שנבדקו

| אפשרות | יתרונות | חסרונות | החלטה |
|---|---|---|---|
| Hermes Desktop Plugin | אותו process ו־state; UI kit רשמי; hot reload; gateway ו־events מובנים; אין Electron שני | דורש Hermes Desktop עדכני; plugin מקומי הוא קוד מהימן עם סמכות ה־app | **נבחר** |
| Thin Client מעל `hermes serve` | שליטה מלאה במעטפת ובמיתוג; אפשר להחליף את כל ה־chrome | צריך לנהל Electron נוסף, token, lifecycle, reconnect, event hydration, preview ופריטי parity | fallback בלבד |
| Fork של Hermes Desktop | חופש מוחלט | תחזוקה ועדכונים יקרים; מפר את מטרת הפרויקט | נדחה |

ה־SDK החדש מספק בדיוק את ה־seam שחיפשנו. Thin Client היה הגיוני לפני קיומו או אם נדרש UI שאינו יכול לחיות בתוך Hermes, אך אינו ברירת המחדל הנכונה ל־POC הזה.

## התקנה והפעלה

### Windows

Hermes מספק מתקין PowerShell רשמי. בהתקנה native ברירת המחדל היא:

- בסיס התקנה ונתונים: `%LOCALAPPDATA%\hermes`;
- ה־CLI: `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`;
- Profile ברירת המחדל נשמר באותו Hermes home;
- Profile בשם נשמר תחת `profiles/<name>`.

הפקודה `hermes desktop` בונה/פותחת את אפליקציית Electron הרשמית. ה־plugin של ה־POC מותקן ב:

```text
%LOCALAPPDATA%\hermes\desktop-plugins\business-shell\plugin.js
```

Hermes צופה בתיקייה וטוען שינויים מחדש. ה־plugin מופיע גם תחת Settings → Plugins וניתן לכבות אותו.

לריצה ברקע ב־Windows, Hermes ממליץ על Scheduled Task בעת login ולא על Windows Service. אם יצירת Scheduled Task דורשת UAC והמשתמש אינו מאשר, Hermes נופל רשמית ל־Startup-folder login item. ה־bootstrapper מפעיל:

```powershell
hermes gateway install --start-now --start-on-login
```

ה־Gateway הרקע נדרש לערוצי הודעות ולביצוע אוטומטי של Cron. `hermes serve` או ה־TUI gateway של Desktop לבדם אינם מפעילים את ticker של Cron.

מקורות: [Windows native guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/windows-native.md), [Desktop guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/desktop.md).

### `hermes serve`

ללקוח חיצוני Hermes תומך בשרת headless:

```powershell
$env:HERMES_DASHBOARD_SESSION_TOKEN = "<random-session-token>"
$env:HERMES_DESKTOP = "1"
hermes serve --host 127.0.0.1 --port 9119
```

- `serve` הוא headless תמיד בגרסה שנבדקה; אין בה flag בשם `--no-open`;
- WebSocket: `/api/ws?token=<token>`;
- REST: `/api/*` עם Bearer token;
- החיבור הוא JSON-RPC מעל WebSocket;
- אין לחשוף את השרת לרשת ללא שכבת auth ותצורה מפורשת.

ה־POC הראשי אינו צריך להפעיל `serve` בעצמו: Hermes Desktop כבר מנהל את ה־gateway וה־plugin מקבל את החיבור דרך `host`.

## Sessions, Streaming ו־Tool Calls

ה־gateway הרשמי מספק בין היתר:

- `session.create`
- `session.list`
- `session.resume`
- `session.history`
- `session.interrupt`
- `prompt.submit`
- `approval.respond`
- `clarify.respond`

אירועים מרכזיים:

- `gateway.ready`
- `session.info`
- `message.start`
- `message.delta`
- `message.interim`
- `message.complete`
- `reasoning` / `thinking`
- `status.update`
- `tool.start`
- `tool.progress`
- `tool.complete`
- `approval.request`
- `clarify.request`
- `sudo.request`
- `secret.request`
- `background.complete`
- `error`

`session.list` מציג שיחות מכל הממשקים האנושיים ומסנן רק session פנימי מסוג `tool`. לכן שיחה מה־Desktop, CLI, Telegram או client אחר מופיעה באותו state.

ב־plugin אין צורך לממש reducer לשיחה. כפתורי “שיחה חדשה” ו“פתח שיחה” מנווטים ל־Chat המקורי של Hermes, שכבר מטפל ב־Streaming, attachments, stop, reasoning, tools ו־reconnect.

מקורות: [Session methods](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/tui_gateway/methods_session.py), [Prompt methods](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/tui_gateway/methods_prompt.py).

## אישורי פעולות

Hermes שולח `approval.request` עם command שעבר redaction ועם choices זמינים. התשובה נשלחת באמצעות:

```json
{
  "method": "approval.respond",
  "params": {
    "session_id": "<runtime-session-id>",
    "choice": "<approved-choice>"
  }
}
```

Hermes Desktop כבר מציג כרטיס אישור inline ומקשר אותו ל־Tool Call הנכון. המעטפת אינה מחליפה מנגנון זה. היא יכולה רק:

- לתרגם activity ל־copy עסקי;
- לנווט את המשתמש ל־session שמחכה לאישור;
- להוסיף הסבר לפני פתיחת ה־Chat.

## Profile, Memory, Workspace ו־Skills

המצב שייך ל־Hermes profile, לא ל־plugin:

- `SOUL.md` — זהות והתנהגות בסיסית;
- `memories/USER.md` — עובדות יציבות וקצרות על המשתמש;
- `memories/MEMORY.md` — זיכרון כללי שנבחר להזרקה;
- `skills/` — Skills של ה־profile;
- `workspace/` — קבצי עבודה;
- `state.db` ו־`sessions/` — שיחות ומטא־דאטה.

תכנון ה־onboarding:

- עובדות קצרות על המשתמש נשמרות באמצעות כלי ה־memory/profile של Hermes;
- ההקשר העסקי המפורט והתהליכים נשמרים ב־Skill בשם `business-context`;
- אין system prompt ענקי;
- ה־plugin שומר עותק UI מקומי של טופס ה־onboarding רק ב־`ctx.storage`, לצורך עריכה. הוא אינו מקור האמת של הסוכן;
- השליחה מתבצעת בתוך Session רגיל בשם “היכרות עם העסק”, ולכן הפעולה והתגובה נגישות גם בממשק המלא.

Hermes כולל `skills.manage`, `skills.reload`, learning graph וכלים ליצירה/עריכה של Skills. ה־POC משתמש בהם ואינו בונה Skill Engine.

מקורות: [Prompt assembly](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/website/docs/developer-guide/prompt-assembly.md), [Skills gateway methods](https://github.com/NousResearch/hermes-agent/blob/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/tui_gateway/methods_tools.py).

## Providers

Hermes מציג Providers ומודלים באמצעות:

- `setup.status`
- `setup.runtime_check`
- `model.options`
- `model.save_key`
- `model.disconnect`
- `config.get` / `config.set`

ה־Desktop כולל מסכי Provider Accounts ו־API Keys. ה־plugin מציג מצב פשוט ומנווט למסך הרשמי:

```text
/settings?tab=providers&pview=keys
```

זה חוסך שמירת key בתוך ה־plugin ומבטיח שה־credential lifecycle הרשמי של Hermes מטפל ב־`.env`, ב־rotation, ב־config mirrors וב־runtime reload.

Providers שנצפו במנגנון הרשמי כוללים OpenAI, Anthropic, Gemini/Google, OpenRouter וספקים נוספים לפי ה־registry וההתקנה הפעילה.

## שירותים חיצוניים

### Google Workspace

Hermes כולל Skill רשמי `google-workspace` עבור Gmail, Calendar, Drive, Docs, Sheets ו־Contacts. תהליך ההתחברות:

1. העלאת client secret;
2. בחירת services;
3. יצירת auth URL;
4. הסכמה בדפדפן;
5. מסירת redirect URL / auth code;
6. בדיקת החיבור.

ה־POC פותח Session רגיל שמנחה את Hermes להשתמש ב־Skill הרשמי. אין OAuth implementation נוסף. פעולות כתיבה נשארות כפופות לאישורים של Hermes.

מקור: [Google Workspace Skill](https://github.com/NousResearch/hermes-agent/tree/8defb9fd60bebe2802eaab7c57fa2ee6a4ff6281/skills/productivity/google-workspace).

### Telegram

Telegram הוא messaging platform מובנה ב־gateway. ה־plugin מפנה למסך `/messaging`, שמנהל את `TELEGRAM_BOT_TOKEN`, רשימת משתמשים מותרים, enable/test ו־gateway restart באמצעות ה־API הרשמי.

### WhatsApp

Hermes תומך בשני מסלולים ויש להציג את ההבדל:

- WhatsApp Business Cloud API — המסלול הרשמי של Meta, דורש Business account ו־webhook ציבורי;
- Baileys / WhatsApp Web — מסלול לא רשמי, עם סיכון לחסימה; מומלץ מספר ייעודי.

ה־POC אינו מסתיר את הסיכון ואינו מציג את Baileys כחיבור רשמי.

## Scheduled Tasks

Hermes מספק RPC `cron.manage`:

- `list`
- `add`
- `pause`
- `resume`
- `remove`

וכן REST מלא תחת `/api/cron/jobs`. ה־plugin מציג presets אנושיים, לדוגמה “ימים א׳–ה׳ בשעה 08:00”, וממיר אותם ל־schedule רק בעת השמירה. ה־job נוצר במנגנון Hermes ולכן מופיע גם במסך `/cron`.

אין Scheduler חדש ואין database נוסף.

נמצא פער ב־JSON-RPC העדכני: `cron.manage(list)` אינו מעביר את
`include_disabled` אל כלי ה־Cron, אף שה־REST וה־CLI כן תומכים בו. לכן משימה
מושהית נעלמת מתשובת הרשימה. המעטפת שומרת ב־plugin storage רק cache תצוגה
מצומצם של מזהי המשימות שהמשתמש השהה דרכה, וממזגת אותו עם הרשימה הרשמית.
ה־schedule, ה־prompt וה־state נשארים במנגנון Hermes; פעולות pause/resume
עצמן ממשיכות לעבור רק דרך `cron.manage`. זהו adapter זמני עד שה־RPC יעביר
`include_disabled`.

## תמיכה, Logs ואבחון

ה־SDK מספק:

- `host.state.gateway`
- `host.state.model`
- `host.state.profile`
- `host.status()`
- `host.logs()`
- `host.restartGateway()`

ל־Desktop עצמו קיימים גם:

- `/api/ops/doctor`
- `/api/ops/security-audit`
- `/api/ops/backup`
- `/api/ops/debug-share`

ה־POC מציג health בסיסי בתוך הדף העסקי ומפנה למסך ה־Gateway הרשמי עבור האבחון הטכני המלא.

חשוב: `debug-share` הרשמי של Hermes מפעיל secret redaction, אבל אוסף logs מלאים
והתיעוד שלו מזהיר ש־PII אינו בהכרח מוסתר. לכן הוא **אינו** עומד לבדו בדרישה
המחמירה של מוצר זה, שאוסרת גם תוכן שיחות, מיילים, קבצי עסק ופרטי לקוחות.
המעטפת אינה מפעילה או מעלה `debug-share` אוטומטית.

ה־fallback המצומצם ב־`electron/main.cjs` יוצר ZIP מקומי שכולל רק allowlist של
גרסאות ומוני/מצבי runtime. הוא אינו כולל raw logs כלל, משום שגם log שעבר
secret redaction עלול להכיל prompt, נתיב לקוח או תוכן עסקי. אין בו dump של
שיחות, מיילים, Skills, Memory או קבצי עבודה. כדי להביא את אותה פעולה לתוך עמוד ה־Desktop Plugin נדרש verb
מצומצם ב־SDK או backend plugin מקומי; עד אז אין להציג את `debug-share` כחבילה
הבטוחה של המעטפת.

## עדכונים

Hermes Desktop כולל מסך About/Updates וקורא ל־API:

- בדיקת גרסה;
- הורדה/החלה;
- דיווח מצב;
- restart ו־health.

ה־plugin מפנה ל:

```text
/settings?tab=about
```

ה־plugin עצמו הוא קובץ קטן ונפרד תחת ה־profile. עדכון Hermes אינו אמור למחוק Profile, Sessions, Memory או Skills. המתקין של המעטפת צריך לבדוק גרסת SDK מינימלית ולהחליף רק את `desktop-plugins/business-shell/plugin.js`.

## אבטחה

Desktop Plugin מקומי רץ ב־renderer עם סמכות ה־app. מנגנון הטעינה מספק error isolation, לא sandbox אבטחתי. לכן:

- מתקינים רק bundle מקומי חתום/בדוק;
- שומרים receipt עם SHA-256;
- לא טוענים plugin מרוחק בזמן ריצה;
- לא שומרים secrets ב־`ctx.storage`;
- API keys נשמרים רק במנגנוני Hermes;
- אין remote access, telemetry או backdoor;
- backend Python אינו נדרש ל־POC הנוכחי.

## מיפוי דרישות ליישום

| דרישה | מימוש |
|---|---|
| אותו State | Plugin בתוך Hermes Desktop |
| Sessions/Chat | ה־Chat המקורי של Hermes |
| Streaming וקבצים | ה־renderer וה־composer המקוריים |
| Tool activity | אירועי `tool.*`; copy עסקי בלבד |
| אישורים | ה־Approval renderer המקורי |
| Onboarding | Session רגיל + Memory + `business-context` Skill |
| Provider | מסך Providers הרשמי + `setup.runtime_check` |
| Google Workspace | ה־Skill הרשמי |
| Telegram | `/messaging` הרשמי |
| WhatsApp | הצגת שני המסלולים בשקיפות |
| Skills | `skills.manage`, learning events והמסך `/skills` |
| Scheduled Tasks | `cron.manage` והמסך `/cron` |
| Health/Logs | `host.status`, `host.logs`, `host.restartGateway` |
| אבחון | health/logs ב־Plugin; ZIP מצומצם ב־launcher. `debug-share` אינו מופעל אוטומטית |
| עדכון | מסך About/Updates המקורי |
| Hermes מלא | ניווט ישיר לכל מסכי הליבה |

## מצב Mini Chat

ה־launcher כולל מצב חלון קומפקטי עבור משתמש שרוצה שהעוזר יהיה זמין ליד
העבודה השוטפת בלי לפתוח Dashboard:

- גודל ברירת מחדל `390×640`, עם מינימום `340×440`;
- מיקום אוטומטי בפינת ה־work area הפעילה;
- Always-on-top לבחירה, שנשמר כהעדפת UI מקומית;
- כפתורי שיחה חדשה, הצמדה, הרחבה והסתרה;
- System Tray עם פתיחה, Mini, חלון מלא ויציאה;
- Single-instance: הפעלה נוספת מחזירה את החלון הקיים במקום ליצור Runtime נוסף;
- סגירת `X` מסתירה ל־Tray; רק “יציאה” מסיימת את ה־launcher ואת `hermes serve`
  המנוהל שלו.

במצב זה המיתוג הראשי הוא “העוזר שלי”. השם Hermes מופיע רק כקרדיט קטן
“מופעל באמצעות Hermes” ובגישה לכלים המתקדמים. אין שינוי בארכיטקטורה:
ה־WebSocket, ה־Session, האישורים וה־state הם אותם מנגנוני Hermes של החלון
המלא.

## מגבלות POC ידועות

- נדרשת גרסת Hermes Desktop הכוללת את `@hermes/plugin-sdk`.
- ה־plugin אינו משנה את מסך ברירת המחדל של Hermes; הוא מוסיף כניסה ברורה “לעסק” בסרגל הצד וב־command palette.
- אשף Google Workspace נפתח כ־Session מונחה כדי להשתמש ב־Skill הרשמי. אם Hermes יוסיף contribution ייעודי ל־OAuth, ניתן להחליף את המסך בלי לשנות runtime.
- יצירת ZIP אבחון מצומצם קיימת ב־launcher, אך ה־SDK הנוכחי אינו חושף save-file
  verb שמאפשר להפעיל אותה ישירות מתוך עמוד ה־Plugin. `debug-share` הרשמי אינו
  תחליף תחת מדיניות "ללא תוכן/PII".
- תרגום שמות Tool Calls נעשה רק לצורך הודעת פעילות; כרטיסי Tool/Approval המלאים נשארים של Hermes.

## עדכון יישום ובדיקות — 31 ביולי 2026

נוספה שכבת `business-bootstrap` כ־Skill רגיל של Hermes. התוסף אינו מחזיק
שאלון מקביל כברירת מחדל: בכניסה הראשונה הוא יוצר Session אמיתי ומבקש מהסוכן
להפעיל את ה־Skill. ה־Skill קורא רק מצב קיים קצר, משתמש ב־Memory וב־Skills,
שואל שאלה אחת בכל פעם, ומוביל בהמשך לחיבור הרשמי בעל הערך הגבוה ביותר,
ל־Skill עסקי ראשון ולמשימה מתוזמנת ראשונה.

בדיקת E2E ראשונה חשפה שסריקת מצב רחבה (`hermes doctor` וגילוי פקודות) עיכבה
את השאלה הראשונה בכחמש דקות. חוזה ה־Skill הוקשח: עד שלוש קריאות read-only
קצרות, ללא doctor, connectivity suite, update check, סריקה רחבה או גילוי
פקודות דרך `--help`. בבדיקה החוזרת הסוכן:

- קרא שלושה מקורות בלבד;
- זיהה Profile, שפה, סגנון ו־`business-context` קיימים;
- סימן חיבורים שלא ניתן היה לאמת במהירות כלא־ודאיים;
- הציג שאלה אחת ב־structured question UI המקורי של Hermes;
- לא ביקש secret ולא ביצע חיבור או פעולה חיצונית.

נבנו ונבדקו שני מסלולי הפצה:

1. `Hermes-Business-Web-Setup-0.3.0.exe` — מתקין NSIS בגודל 91,099 bytes.
   הוא מזהה/מוריד Hermes רשמי, מתקין Plugin + Skill, מפעיל Gateway, מבצע
   Health Check ופותח את Hermes Desktop. הרצה שקטה מול Hermes 0.19.0 הסתיימה
   ב־exit code 0 ושמרה את כל ה־state.
2. `העוזר לעסק Setup 0.3.0.exe` — companion אופציונלי בגודל כ־84.6MB,
   משום שהוא כולל Electron/Chromium. הוא מספק חלון `390×640`, Always-on-top,
   Tray, הסתרה/הרחבה ומיתוג “העוזר שלי”.

ה־Companion המותקן נבדק בפועל: הודעה נשלחה מהחלון הקטן, התקבלה ב־Streaming
תשובת `MINI_E2E_OK`, וה־Session הופיע מיד ונפתח עם אותו transcript בתוך
Hermes Desktop המלא. בדיקת ה־Gateway לאחר ההתקנה עברה את כל ה־deep probes.

מסקנת ההפצה: המתקין הזעיר הוא ברירת המחדל למשתמש שצריך את Hermes Desktop
עם המעטפת העסקית; ה־Companion הכבד הוא רכיב אופציונלי רק למי שרוצה צ׳אט
קטן וקבוע על שולחן העבודה.

## תוצאות בדיקה מקומית — 30 ביולי 2026

- המתקין הרשמי השלים התקנה native של Hermes `0.19.0` ו־Hermes Desktop.
- ה־Desktop עלה עם backend על port דינמי והציג `Gateway ready`.
- OpenAI Codex חובר ב־device-code OAuth, `setup.runtime_check` החזיר
  `openai-codex`, וניסיון inference אמיתי עם `gpt-5.6-sol` עבר.
- `business-shell` נטען מה־disk plugin הרשמי והופיע בסרגל הצד.
- נבדקו בפועל מסכי onboarding, חיבורים, משימות ותמיכה, וכן חזרה ל־Hermes המלא.
- JSON-RPC WebSocket התחבר והחזיר `gateway.ready`.
- `session.create`, ‏`session.list` ושיתוף ה־state עברו: Session שנוצר דרך
  WebSocket הופיע מיד ב־Desktop, נפתח מהחיפוש העסקי והציג את אותו transcript.
- Streaming אמיתי עבר עם 13 אירועי `message.delta` ו־`message.complete`.
- צירוף `README.md` דרך ה־composer המקורי עבר; Hermes קרא את כותרת ה־H1.
- עצירת תגובה ארוכה דרך כפתור Stop המקורי עברה.
- מצב approvals הוחלף זמנית ל־`manual`; פקודת `Remove-Item ... -WhatIf`
  הציגה את כרטיס האישור המקורי. “Run once” אושר, לא נוצר/נמחק קובץ, והמצב
  הוחזר ל־`smart`.
- onboarding אמיתי יצר/עדכן Memory ו־Skill בשם `business-context`. ה־Skill
  הופיע במסך Capabilities המלא כ־`learned`, ו־`google-workspace` נשאר Skill
  רשמי זמין. `skills.manage` גילה 62 Skills פעילים.
- `cron.manage` עבר מחזור אוטומטי מלא: add → pause → resume → remove.
  בנוסף נוצר `POC סיכום בוקר`, ה־Gateway הרשמי הותקן כרקע, והמשימה הורצה
  ידנית מקצה לקצה עם run status `completed`. היא הושארה מושהית כדי שלא
  תצרוך מודל בעתיד והופיעה כך גם במעטפת וגם במסך Cron המלא.
- `host.restartGateway()` עבר; ה־Gateway חזר ל־ready וכל ה־Sessions נשמרו.
- `host.logs()` הציג את ה־Logs המקומיים, ובדיקת התקינות אימתה Hermes ו־Provider.
- ה־NSIS נבדק בהתקנה אמיתית למשתמש הנוכחי תחת
  `%LOCALAPPDATA%\Programs\hermes-business`. האפליקציה המותקנת עלתה ללא
  Terminal, זיהתה `Hermes פעיל`, והציגה את אותן שיחות POC שכבר היו זמינות
  ב־Hermes Desktop.
- מסלול ה־launcher/fallback נוקה מנתוני דמו: Sessions, הודעות, מוני משימות,
  Skills וסטטוסי Google/Telegram אינם מוצגים עוד כמידע אמיתי לפני שהתקבלו
  מ־Hermes.
- תוקן race בהפעלה שבו renderer שהגיע בזמן `startHermes()` היה נשאר על
  “Hermes עולה…”. קריאות מקבילות ממתינות כעת לאותה פעולת start; מופע שני
  מפנה למופע הקיים, וסגירה מסיימת את כל עץ תהליך `hermes serve`. בבדיקת
  הסגירה לא נשאר process או listener על port 9119 ולא הופיע חלון שגיאה.
- חבילת האבחון נוצרה דרך ה־UI ונפתחה מחדש בבדיקה: היא הכילה רק
  `diagnostics.json` ו־`README.txt`. סריקה רקורסיבית לא מצאה שדות
  key/token/secret/password, תוכן שיחה, כתובות בדיקה או פרטי onboarding.
- Google Workspace Skill נמצא אך `--check` החזיר `NOT_AUTHENTICATED`; השלמת
  OAuth דורשת `client_secret.json` של Google Cloud והסכמת המשתמש בדפדפן.
- Telegram קיים כפלטפורמה רשמית אך אינו מוגדר; השלמת E2E דורשת Bot Token
  ו־allowed user id. לא הוזנו credentials מומצאים ולא נפתח חיבור לא מאושר.
- `hermes update --check` עבד וזיהה שההתקנה מאחורי `origin/main`. העדכון עצמו
  לא הוחל: ה־Desktop, ה־Gateway וה־venv פעילים, וה־checkout כולל 280 שינויים.
  `hermes update --help` מזהיר במפורש מפני `--force-venv` במצב זה.
- `npm audit` של `apps/desktop` בהתקנת upstream דיווח 28 ממצאים
  (1 low, ‏26 high, ‏1 critical; ה־critical הוא dependency עקיף `tar`).
  לא הופעל `npm audit fix` על קוד upstream.
- המתקין/ה־build הרשמי השאירו checkout מלוכלך: 280 קבצים. רובם שינויי
  line-ending/generated files. מנגנון update יודע
  לבצע stash, אך זהו סיכון Windows שיש לתקן או לפחות להציג לפני release.

סקריפט הקבלה החוזר:

```powershell
npm run test:e2e:hermes
```

הוא מפעיל `hermes serve` מבודד על loopback עם token אקראי, בודק Provider,
Streaming, Session משותף, Skills ומחזור Cron, ואז סוגר רק את process הבדיקה.
