# תוכנית שיפור — תכל'ס (2026-08-03)

מקור: סקירת ארכיטקטורה מלאה בארבע שכבות (Electron main, React, scripts/release,
plugins+shared). העיקרון: הליבות הטהורות מצוינות; החולשה השיטתית היא ב"קילומטר
האחרון" — שגיאות שלא מגיעות למשתמש, רשימות מסונכרנות ביד, וכלים שמשכפלים לוגיקת
מוצר. הסדר: רשתות ביטחון → אמינות → facade → dedup → ניקיון.

**מחוץ לתוכנית:** רגרסיית מצב ה-QA המבודד (`runtime-mode.cjs` מייבא resolver
לא-ממומואיזם ⇒ בדיקת empty-home רצה מחדש אחרי ש-`main.cjs:45` יצר
`electron-user-data` ⇒ `QaOverrideError` בכל קריאה עוקבת) — מטופלת בסשן נפרד
(task_e3941eb9). עד למיזוגה לא נוגעים ב-`runtime-mode.cjs`, `qa-runtime.cjs`,
`main.cjs`.

כללי ביצוע: כל משימה = סוכן אחד עם בעלות בלעדית על קבציו; שער `npm test`
(+`verify:plugin` כשנוגעים במקור הפלאגין) בסוף כל שלב; בלי commits אלא אם התבקשו.

## שלב 1 — רשתות ביטחון

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 1.1 | בדיקות lockstep לרשימות ההתקנה: reverse-check `readdir ⊆ allow-list` לפלאגין המדיניות (`electron/paths.cjs:64`) ול-backend הנלווה; כיסוי `scripts/e2e-bootstrap-clean.ps1` + `e2e-companion-bootstrap.ps1` (לא מאומתים); תיקון substring false-positive בבדיקת ה-NSI (`contract.py` ⊂ `tool_contract.py`) | Sonnet | ✅ הושלם |
| 1.2 | חיווט 7 בדיקות האבטחה של `hermes-plugin/business-shell/dashboard/test_plugin_api.py` ל-`test:plugin:policy`/`test:contract`/`verify:release` (כיום לא רצות באף סקריפט) | Sonnet | ✅ הושלם |
| 1.3 | בדיקת parity ל-`shared/`: כל export ב-`.js` ⇔ `.d.ts`; תיקון דריפט קיים — `compatible` חסר ב-`onboarding-bootstrap.d.ts:13`; טיפוסי snapshot מוצהרים במקום `Record<string, unknown>` | Sonnet | ✅ הושלם |
| 1.4 | בדיקות lockstep לקבועים כפולים: QA sentinel (3 עותקים), טווח פורטים 41000–60000 (2), regex נתיבי E2E (2), טווח תאימות Hermes (4 מקומות) | Sonnet | ✅ הושלם |

תוספת תוך-כדי: `vite.config.ts` — החרגת `**/.claude/**` (worktrees של סשנים
מקבילים) מסריקת vitest; שער שלב 1 ירוק (152 קבצים, 1194 בדיקות).

## שלב 2 — אמינות ליבה

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 2.1 | WS reconnect + backoff ב-`transport.ts` (אין `close` listener; ניתוק = צ'אט מת לצמיתות); דחיית in-flight על close; `onRestart` ממתין לחיבור מאומת לפני toast | Opus | ✅ הושלם |
| 2.2 | נורמליזציית שגיאות IPC בגבול (העברית מ-main לא שורדת את עטיפת Electron); איחוד redaction על `redact.cjs` ומחיקת `security.cjs` (החלש שומר על הלוג החי); סריאליזציית `hermes:install` | Opus | ✅ הושלם |
| 2.3 | כנות תצוגה: `loadErrors` ל-`TasksScreen`/`ConnectionsScreen` (כשל קריאה מוצג כ"0 משימות"); רינדור `useAsync().error` ב-4 מסכי הפלאגין; תיקון `onToggle` הבולע + חתימות `=> Promise<void>` | Sonnet | ✅ הושלם |

הערות שלב 2: (א) חידוש זרם אירועי צ'אט אחרי reconnect דורש `session.resume` —
מועבר לשלב 3 (חיווט ב-`useChat`). (ב) `getWhatsappGuardActivation` מחווט
ב-preload/ipc אך לא מוצהר ב-`vite-env.d.ts` ואין לו צרכן — לטפל בשלב 3/5.
(ג) `testTimeout: 15000` ב-vite.config — סוויטות spawn-כבדות תחת עומס מקבילי.

## שלב 3 — facade ו-demo

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 3.1 | ניתוב ~20 קריאות `window.hermesDesktop` ישירות דרך `HermesClient`; fixtures ל-demo; מחיקת ענפי `hermesClient.demo` מקומפוננטות (בראשן `WhatsappCloudConnect.tsx:35` שעוקף בדיקת בטיחות) | Opus | ✅ הושלם |

הערות שלב 3: chokepoint שלישי `src/lib/hermes/desktop.ts` (19 מתודות);
`useAssistantWindow` נשאר חריג מתועד (window plumbing); שער ה-onboarding
ב-`App.tsx` נשאר בכוונה (הוכחת בעלות מאומתת — demo לא מזייף ראיות);
`chat-resume.ts` seam טהור ל-`session.resume` אחרי reconnect; שער ירוק
(156 קבצים, 1254 בדיקות). שלב 4 אוחד ל-3 סוכנים (4.2+4.3 מוזגו — חפיפת קבצים).

## שלב 4 — איחוד כפילויות

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 4.1 | Electron dedup: 5 כתיבות temp+rename ידניות → `safeWrite`; 3 נורמליזציות WhatsApp principals → אחת; `isUnder` ×3 → `path-containment.cjs`; journal של guard-activation לחוזה של update-journal-store | Sonnet | ✅ הושלם |
| 4.2 | Scripts dedup: harness משותף `probe-app.mjs` ל-6 סקריפטי UI (כולל ניקוי temp-dir); `dev-desktop.mjs` מייבא קבועים; `parseChannel` אחד; `package-win.mjs` מאחד את שני הצינורות | Opus | ✅ הושלם (מוזג עם 4.3) |
| 4.3 | חיזוק שער ה-E2E: הרביעייה המלאה נדרשת (ולידטורים מיובאים מ-`qa-runtime-policy.cjs`); `live-restore-journal.mjs` עמיד-לקריסה עם profile scoping; החלה על `e2e-missing-hermes-ui` | Opus | ✅ הושלם |
| 4.4 | `shared/schedule-display` + `shared/tool-copy` בדפוס `cron-identity-contract`; חיבור שני ה-UI + בדיקות parity; בדיקת ה-parity הוסבה לגילוי אוטומטי מהדיסק | Sonnet | ✅ הושלם |

הערות שלב 4: (א) התגלה באג סמוי קיים-מראש ב-`isUnder` (גבול-מפריד no-op —
`/tmp-evil` נחשב תחת `/tmp`) — שומר על ההתנהגות, תועד בבדיקה, נפתח task נפרד.
(ב) `e2e-missing-hermes-ui` הוסב למצב runtime פיתוח (production מסרב ל-home
זמני — התנהגות נכונה). (ג) שער ירוק: 163 קבצים, 1409 בדיקות + `verify:plugin`.

## שלב 5 — ניקיון וליטוש

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 5.1 | קוד מת: שרשרת onboarding ישנה (443 שורות נמחקו), `qa-electron-namespace.cjs`, exports מתים, פרמטר `_services` מקצה-לקצה, 2 כפתורים ללא handler | Sonnet | ✅ הושלם |
| 5.2 | CSS: `styles/buttons.css` קנוני (מיובא שני); מחיקת מחלקות יתומות + `onboarding-approval.css` שלם; `onboarding-form.css` ‏137→14 שורות; logical properties (שני offsets של window-controls נשמרו פיזיים + הערה) | Sonnet | ✅ הושלם |
| 5.3 | נגישות + toast: Escape/focus-trap/restore ב-`Modal.tsx` (8 דיאלוגים); `role="alert"` ×14; toast עם id+severity לכל הודעה (שגיאות 6s, מרוץ טיימרים נסגר); הוסרה הדחקת ה-toast במסך התמיכה | Sonnet | ✅ הושלם |
| 5.4 | Python: authorizer של guards עטוף fail-closed (באג אמיתי); 3 הדלתות נשארו בכוונה (ניתוב דרך families היה משנה סמנטיקה — תועד); `make_outbound_guard` אחד; docs אמיתיים; renames מ-underscore; `__pycache__` נוקה | Sonnet | ✅ הושלם |
| 5.5 | PowerShell: `Set-StrictMode`+`#Requires` ב-bootstrap; פרמטרים מפורשים ב-`BusinessInstall.ps1`; דחיית PATH מנתיבי E2E; ניתוב דרך `SemVer.ps1` (כולל תיקון באג load-order של `-SkipCompanionInstall`); regex gateway מהודק בהתאם ל-CLI האמיתי | Sonnet | ✅ הושלם |
| 5.6 | `ErrorBoundary` עברי ב-`main.tsx`; README מסונכרן לשמות הסקריפטים החדשים; `.gitignore` + `.pytest_cache` | Sonnet | ✅ הושלם |

## שער סופי — ✅ עבר (2026-08-03)

- `npm test` מלא: 165 קבצים, 1,424 עוברות (כשל בודד ראשון היה timeout חולף תחת
  עומס; ריצה חוזרת נקייה).
- `verify:plugin`: bundle מסונכרן + חוזה SDK מול Hermes 0.19.1 מותקן.
- `test:plugin:policy`: ‏71+7 בדיקות פייתון (כולל ה-dashboard שחווט בשלב 1).
- `npm run build`: הצליח (אזהרת chunk>500kB אינפורמטיבית בלבד).
- `test:e2e:installed-isolated` **נדחה בכוונה**: תלוי בתיקון רגרסיית ה-QA שרץ
  בסשן נפרד (task_e3941eb9) — יש להריץ אחרי מיזוגו + `build:test-packaged` טרי.

## ממצאים שנפתחו כמשימות נפרדות תוך כדי

- רגרסיית מצב QA מבודד (סשן נפרד, task_e3941eb9).
- באג סמוי ב-`isUnder` — גבול-מפריד no-op, `/tmp-evil` נחשב תחת `/tmp`
  (task_8e7e3608; קיים-מראש, תועד בבדיקה, ההתנהגות שומרה).
