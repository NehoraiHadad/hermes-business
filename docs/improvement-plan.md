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
| 1.1 | בדיקות lockstep לרשימות ההתקנה: reverse-check `readdir ⊆ allow-list` לפלאגין המדיניות (`electron/paths.cjs:64`) ול-backend הנלווה; כיסוי `scripts/e2e-bootstrap-clean.ps1` + `e2e-companion-bootstrap.ps1` (לא מאומתים); תיקון substring false-positive בבדיקת ה-NSI (`contract.py` ⊂ `tool_contract.py`) | Sonnet | בתהליך |
| 1.2 | חיווט 7 בדיקות האבטחה של `hermes-plugin/business-shell/dashboard/test_plugin_api.py` ל-`test:plugin:policy`/`test:contract`/`verify:release` (כיום לא רצות באף סקריפט) | Sonnet | בתהליך |
| 1.3 | בדיקת parity ל-`shared/`: כל export ב-`.js` ⇔ `.d.ts`; תיקון דריפט קיים — `compatible` חסר ב-`onboarding-bootstrap.d.ts:13`; טיפוסי snapshot מוצהרים במקום `Record<string, unknown>` | Sonnet | בתהליך |
| 1.4 | בדיקות lockstep לקבועים כפולים: QA sentinel (3 עותקים), טווח פורטים 41000–60000 (2), regex נתיבי E2E (2), טווח תאימות Hermes (4 מקומות) | Sonnet | בתהליך |

## שלב 2 — אמינות ליבה

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 2.1 | WS reconnect + backoff ב-`transport.ts` (אין `close` listener; ניתוק = צ'אט מת לצמיתות); דחיית in-flight על close; `onRestart` ממתין לחיבור מאומת לפני toast | Opus | ממתין |
| 2.2 | נורמליזציית שגיאות IPC בגבול (העברית מ-main לא שורדת את עטיפת Electron); איחוד redaction על `redact.cjs` ומחיקת `security.cjs` (החלש שומר על הלוג החי); סריאליזציית `hermes:install` | Opus | ממתין |
| 2.3 | כנות תצוגה: `loadErrors` ל-`TasksScreen`/`ConnectionsScreen` (כשל קריאה מוצג כ"0 משימות"); רינדור `useAsync().error` ב-4 מסכי הפלאגין; תיקון `onToggle` הבולע + חתימות `=> Promise<void>` | Sonnet | ממתין |

## שלב 3 — facade ו-demo

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 3.1 | ניתוב ~20 קריאות `window.hermesDesktop` ישירות דרך `HermesClient`; fixtures ל-demo; מחיקת ענפי `hermesClient.demo` מקומפוננטות (בראשן `WhatsappCloudConnect.tsx:35` שעוקף בדיקת בטיחות) | Opus | ממתין |

## שלב 4 — איחוד כפילויות

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 4.1 | Electron dedup: 5 כתיבות temp+rename ידניות → `safeWrite`; 3 נורמליזציות WhatsApp principals → אחת; `isUnder` ×3 → `path-containment.cjs`; journal של guard-activation לחוזה של update-journal-store | Sonnet | ממתין |
| 4.2 | Scripts dedup: harness משותף ל-4 סקריפטי ה-installed-UI (כולל ניקוי temp-dir שדולף כיום); `dev-desktop.mjs` מייבא קבועים מ-`runtime-mode.cjs` במקום שכפול; `parseChannel` אחד; איחוד שני צינורות ה-packaging | Sonnet | ממתין |
| 4.3 | חיזוק שער ה-E2E: `assertSafeInstalledE2E` מוכיח בידוד (לא בדיקת טוקן); החלה על `e2e-missing-hermes-ui.mjs` + יישור שם ל-convention; שחזור מדיניות עמיד-לקריסה בסקריפטים על פרופיל חי | Opus | ממתין |
| 4.4 | `shared/schedule-display` + `shared/tool-copy` בדפוס `cron-identity-contract`; חיבור שני ה-UI + בדיקות parity (כיום: פלאגין עם טבלת 3 ערכים מול קומפיילר מלא ב-React) | Sonnet | ממתין |

## שלב 5 — ניקיון וליטוש

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 5.1 | קוד מת: שרשרת onboarding ישנה (~470 שורות+CSS), `qa-electron-namespace.cjs`, exports מתים, `__pycache__` עם telegram ישן, 2 כפתורים ללא handler | Sonnet | ממתין |
| 5.2 | CSS: `styles/buttons.css` (4 התנגשויות `primary/ghost/outline/connected-button` תלויות סדר `@import`); מחיקת מחלקות יתומות; logical properties | Sonnet | ממתין |
| 5.3 | נגישות + toast: Escape/focus-trap/restore ב-`Modal.tsx`; `role="alert"`; `aria-live`; toast queue במקום מחרוזת יחידה (שגיאות כיום לא נמחקות ורצות זו על זו) | Sonnet | ממתין |
| 5.4 | Python: איחוד 3 מסלולי ההרשאה או ביטול הכללת `families`; try/except ב-`guards.py:36`; איחוד `_make_*_guard` זהים; תיקון docs "BOTH chokepoints" (יש אחד) | Sonnet | ממתין |
| 5.5 | PowerShell: `Set-StrictMode`; פרמטרים מפורשים ב-`BusinessInstall.ps1`; יישור fallback ה-PATH עם מדיניות `paths.cjs:16`; ניתוב דרך `SemVer.ps1` | Sonnet | ממתין |
| 5.6 | `package.json`: צמצום aliases כפולים + הערות על סקריפטים חסומים; `ErrorBoundary` ב-`main.tsx` | Sonnet | ממתין |

## שער סופי

`npm test` מלא, `verify:plugin`, `test:plugin:policy`, `test:e2e:installed-isolated`,
`npm run build`.
