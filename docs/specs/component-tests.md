# אפיון: תשתית בדיקות קומפוננטות (React) — תכל'ס

**מסמך:** `docs/specs/component-tests.md`
**סטטוס:** מוצע | **גרסת אפליקציה:** 0.4.0-alpha.1 | **תאריך:** 2026-08-03

---

## 1. רקע ומצב קיים (ממצאי חקירה)

| שכבה | מיקום | מצב בדיקות |
|---|---|---|
| Main process (Electron) | `electron/*.cjs` + ‏48 קובצי `electron/*.test.ts` | מכוסה, vitest בסביבת `node` (ברירת המחדל) |
| לוגיקה טהורה ב-renderer | `src/lib/**` (‏58 קובצי `*.test.ts`) | מכוסה, `node` |
| סקריפטים | `scripts/lib/**` (‏33 קובצי `*.test.mjs`) | מכוסה, `node`; שני קובצי ה-evidence רצים בזרימה נפרדת |
| **קומפוננטות ו-hooks של React** | `src/components/**` (‏50 קובצי `.tsx`), `src/hooks/**` (‏12 hooks) | **ללא כיסוי render/DOM כלל** — זה הפער שהאפיון סוגר |

עובדות מפתח שהעיצוב נשען עליהן (אומתו בקוד):

1. **אין `vitest.config.*` נפרד** — בלוק `test` יושב בתוך `vite.config.ts` (exclude של `**/.claude/**` ו-`**/promo-video/**`, ‏`testTimeout: 15000`). כל קובצי `*.test.*` נאספים על ידי include ברירת-המחדל של vitest, כולם רצים היום בסביבת `node`. **קבצי `electron/*.test.ts` חייבים להישאר `node`.**
2. **זרימת ה-evidence מוגנת בסקריפטים, לא בקונפיג:** `test:unit` = ‏`vitest run --exclude scripts/lib/evidence.test.mjs --exclude scripts/lib/evidence-subject.test.mjs`; ‏`test:evidence` = ‏`vitest run <שני הקבצים>`. ‏`verify:release` מריץ את שניהם. **אסור לשבור את ההפרדה הזו.**
3. **גרסאות מותקנות (מ-`package-lock.json`):** react ‏19.2.8, react-dom ‏19.2.8, vitest ‏4.1.10, vite ‏6.4.3, typescript ‏5.7.3, ‏@vitejs/plugin-react ‏4.7.0.
4. **ב-Vitest 4 האופציה `environmentMatchGlobs` הוסרה** (deprecated ב-3.0, removed ב-4.0; אומת: המחרוזת אינה קיימת ב-`node_modules/vitest/dist`). האלטרנטיבות האמיתיות הן `test.projects` או docblock פר-קובץ.
5. **`test.projects` היה שובר את זרימת ה-evidence:** בקוד המקור של vitest ‏4.1.10 (`node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js`, ‏`resolveProjects`) רשימת ה-`cliOverrides` המועברת לפרויקטים **אינה כוללת `exclude`** — כלומר עם projects, הדגלים `--exclude` של `test:unit` היו מפסיקים לסנן את בדיקות ה-evidence. זו הכרעה מבוססת-ראיות נגד projects (ר' סעיף 3.1).
6. **הגשר ל-main process הוא `window.hermesDesktop`** (לא `window.hermes`) — נחשף ב-`electron/preload.cjs`, מוגדר טיפוסית ב-`src/vite-env.d.ts` (`HermesDesktopBridge`). הצריכה עוברת דרך ה-facade ‏`hermesClient` (`src/lib/hermes-client.ts`) — **singleton שנבנה בזמן import** וקובע מצב דרך `resolveClientMode()` (‏`src/lib/hermes/core.ts`).
7. **מלכודת demo קריטית:** תחת vitest ‏`import.meta.env.DEV === true`, ולכן אם `window.hermesDesktop` חסר בזמן ה-import הראשון של `hermes-client`, ‏`resolveClientMode` בוחר **demo** — והבדיקות ירוצו בשקט מול fixtures מפוברקים ואופטימיים. לכן ה-double של הגשר חייב להיות מותקן **לפני** כל import של מודול אפליקציה (ר' סעיף 4).
8. ה-facade לוכד בזמן בנייה את **נוכחות** המתודות `applyUpdate` / `probeProvider` — ה-double חייב להגדיר את כל המתודות מראש, וההתנהגות פר-בדיקה מתחלפת בדלגציה (לא בהחלפת האובייקט).
9. RTL: ‏`index.html` מכריז `<html lang="he" dir="rtl">`; jsdom לא טוען את `index.html`, ולכן קובץ ה-setup משחזר זאת.
10. `src/components/ErrorBoundary.test.ts` הקיים בודק רק את `formatErrorDetails` הטהורה, והערה ב-`ErrorBoundary.tsx` (שורות 6–8) מתעדת במפורש "this repo has no render/DOM test infra" — יש לעדכן אותה כשהתשתית נוחתת.
11. `queryFocusable` (‏`src/lib/focus-trap.ts`) מבוסס selector בלבד, בלי סינון נראוּת/layout — לכן מלכודת הפוקוס של `Modal` ניתנת לבדיקה מלאה ב-jsdom.

---

## 2. מטרות ולא-מטרות

### מטרות
1. תשתית vitest + jsdom + ‏@testing-library/react שמאפשרת בדיקות **התנהגות** לקומפוננטות ול-hooks של ה-renderer.
2. **אפס שינוי** בסמנטיקה של `electron/*.test.ts`, ‏`src/lib/*.test.ts`, ‏`scripts/**` ושל זרימת `test:unit` / `test:evidence` / `verify:release`.
3. Double קנוני אחד ל-`window.hermesDesktop` עם ברירות-מחדל **fail-closed** (מצבי unknown/error, לא happy-path), כך שבדיקה ששכחה stub נכשלת בקול או רואה מצב "לא רץ" כן — לעולם לא הצלחה מפוברקת.
4. דפוסים מתועדים: עברית/RTL, מצב אסינכרוני, טיימרים (toasts), גייט onboarding.
5. חבילת עבודה מדורגת בגודל שסוכן Sonnet יכול לבצע שלב-שלב עם קריטריוני קבלה מדידים.

### לא-מטרות
- לא בדיקות ויזואליות/צילומי-מסך ולא snapshot tests (אוסרים snapshots מדיניות — הם מקבעים מבנה, לא התנהגות).
- לא תחליף ל-E2E הקיימים (`test:e2e:installed-ui` וכו') — הם נשארים הסמכות על Electron אמיתי, CSP, layout ו-RTL ויזואלי.
- לא בדיקות של `electron/preload.cjs` דרך jsdom — `electron/preload.test.ts` הקיים כבר בודק את החוזה האמיתי.
- לא כיסוי מלא לכל 50 הקומפוננטות — מכסים לפי סיכון (סעיף 6).
- לא הכנסת `globals: true` — הריפו כולו עובד עם imports מפורשים מ-`vitest`, ונשאר כך.

---

## 3. החלטות תשתית

### 3.1 אסטרטגיית סביבה: docblock פר-קובץ (`@vitest-environment jsdom`) — לא projects

**החלטה:** כל בדיקת DOM מסומנת בשורת docblock ראשונה, וסביבת ברירת-המחדל נשארת `node`.

**נימוק:**
- `environmentMatchGlobs` **לא קיים** ב-vitest ‏4.1.10 (ממצא 4) — הבחירה האמיתית היא projects מול docblocks.
- `test.projects` נפסל על עובדה שנבדקה בקוד vitest (ממצא 5): CLI ‏`--exclude` אינו מופץ לפרויקטים, ולכן `npm run test:unit` היה מתחיל להריץ את בדיקות ה-evidence — שבירה ישירה של האילוץ הקשיח. תיקון היה מחייב ארגון מחדש של `test:unit`/`test:evidence`, שהוגדר מחוץ לתחום.
- docblock משאיר את צנרת ה-node **זהה בייט-לבייט**: אין `setupFiles` גלובלי, אין שינוי ב-module graph של בדיקות electron/scripts, אפס האטה ל-evidence pipeline.
- החיסרון של docblock — "אפשר לשכוח אותו" — מנוטרל בבדיקת lockstep (סעיף 7), בהתאם לתרבות הקיימת בריפו (`constants-lockstep.test.ts` וכד').

### 3.2 קונבנציית שמות: בדיקות DOM הן `src/**/*.test.tsx`

- כל בדיקת render/hook — סיומת `.test.tsx` (גם ל-hooks; ממילא נוח ל-JSX ב-wrappers). כיום אין אף `.test.tsx` בריפו, כך שהקונבנציה נקייה מהיום הראשון.
- בדיקות לוגיקה טהורה נשארות `.test.ts` בסביבת node (כולל `src/components/ErrorBoundary.test.ts` הקיים).
- include ברירת-המחדל של vitest כבר תופס `.tsx` — אין צורך בשינוי include.

### 3.3 סביבת DOM: jsdom (לא happy-dom)

הצוות ביקש jsdom; בנוסף jsdom מממש focus/activeElement/`document.contains` שנחוצים למלכודת הפוקוס של `Modal`, ו-WebSocket (שה-transport עשוי לגעת בו). happy-dom מהיר יותר אך חלקי מדי כאן.

### 3.4 ללא `setupFiles` גלובלי — import מפורש של setup בכל קובץ DOM

`setupFiles` בקונפיג היחיד היה רץ גם על כל בדיקות ה-node וה-evidence. במקום זה, כל קובץ `.test.tsx` פותח ב:

```ts
// @vitest-environment jsdom
import '../test/setup-dom'   // חייב להיות ה-import הראשון (סדר הרצת מודולים ב-ESM)
```

היות ש-ESM מריץ מודולים לפי סדר ה-imports, ‏`setup-dom` מתקין את גשר ה-double **לפני** שכל מודול אפליקציה (ובראשו ה-singleton של `hermes-client`) נטען — מה שסוגר את מלכודת ה-demo (ממצא 7). שני הסימונים נאכפים בבדיקת lockstep.

### 3.5 תלויות להתקנה (devDependencies)

תואמות ל-react ‏19.2.8 ו-vitest ‏4.1.10:

| חבילה | גרסה | הערת תאימות |
|---|---|---|
| `jsdom` | `^27.0.0` | הטווח הנתמך ע"י vitest 4; דורש Node ‏20+ (מתקיים) |
| `@testing-library/react` | `^16.3.0` | ‏peer: ‏react ‏^18\|\|^19 — תומך React 19 רשמית |
| `@testing-library/dom` | `^10.4.1` | **peer מפורש** של RTL ‏16 — חובה להתקין במפורש |
| `@testing-library/user-event` | `^14.6.1` | ‏peer על `@testing-library/dom` |
| `@testing-library/jest-dom` | `^6.9.0` | נטען דרך entry ‏`/vitest` (מרחיב `expect` והטיפוסים אוטומטית) |

אין צורך ב-`@types/*` — כולן מגיעות עם טיפוסים. `typescript ~5.7` ו-`moduleResolution: "Bundler"` פותרים את subpath ‏`@testing-library/jest-dom/vitest` ללא שינוי tsconfig (‏`src/test/` כבר בתוך `include: ["src"]` של `tsconfig.app.json`, ו-lib כולל DOM).

**שים לב:** אחרי `npm install` יש לוודא שחוזה הנעילה הרלוונטי (`gen:lock-attest` / `verify:release-contract`) מרונדר מחדש אם הוא ננעל על ה-lockfile.

---

## 4. עיצוב קובצי התשתית — `src/test/`

### 4.1 `src/test/setup-dom.ts` (side-effect module)

```ts
// Loaded as the FIRST import of every src/**/*.test.tsx (enforced by
// src/test/dom-conventions.test.ts). Runs before any app module, so the
// hermes bridge double exists before the hermes-client singleton is built —
// otherwise resolveClientMode() would silently fall back to DEMO fixtures
// under vitest (import.meta.env.DEV is true).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { installBridge, resetBridge } from './hermes-bridge'

// Mirror index.html (<html lang="he" dir="rtl">) — jsdom does not load it.
document.documentElement.lang = 'he'
document.documentElement.dir = 'rtl'

installBridge()

afterEach(() => {
  cleanup()        // RTL auto-cleanup is OFF without vitest globals — must be explicit
  resetBridge()    // back to fail-closed defaults + clear vi.fn call state
  localStorage.clear()
})
```

### 4.2 `src/test/hermes-bridge.ts` — ה-double הקנוני של `window.hermesDesktop`

**עיקרון:** אובייקט גשר אחד, יציב לכל חיי הקובץ (כי `hermes-client` לוכד נוכחות מתודות בבנייה — ממצא 8), שכל מתודה בו היא `vi.fn` שמדלגת למימוש נוכחי הניתן להחלפה פר-בדיקה.

**API ציבורי:**

```ts
import { vi } from 'vitest'

/** Runtime שמייצג "לא מותקן/לא רץ" — ברירת המחדל הכנה של כל בדיקה. */
export const FAIL_CLOSED_RUNTIME: HermesRuntime = {
  installed: false, running: false, starting: false,
  mode: 'desktop', version: null, error: null, wsUrl: ''
}

/** עוזר לבדיקות שצריכות runtime חי; wsUrl ריק כדי שה-transport לא ינסה socket. */
export function runningRuntime(overrides?: Partial<HermesRuntime>): HermesRuntime

/** מותקן פעם אחת ע"י setup-dom; שגיאה אם כבר קיים גשר זר. */
export function installBridge(): void

/** מיזוג overrides פר-בדיקה; מחזיר את הגשר לצורך assertions. */
export function stubBridge(overrides: Partial<HermesDesktopBridge>): HermesDesktopBridge

/** גישה טיפוסית לגשר לצורך expect(bridge().setWhatsappPolicy).toHaveBeenCalled... */
export function bridge(): HermesDesktopBridge & Record<string, ReturnType<typeof vi.fn>>

/** חזרה לברירות המחדל ה-fail-closed וניקוי מוני קריאות (נקרא מ-afterEach). */
export function resetBridge(): void

/** הדמיית שורת לוג ל-onRuntimeLog הרשומים. */
export function emitRuntimeLog(line: string): void
```

**ברירות מחדל — טבלת fail-closed (החוזה המחייב):**

| קבוצה | מתודות | ברירת מחדל |
|---|---|---|
| Runtime lifecycle | `getRuntime`, `startRuntime`, `restartRuntime` | ‏resolve ל-`FAIL_CLOSED_RUNTIME` (לא רץ — הגייט נופל ל-onboarding, בדיוק כמו במציאות) |
| חלון | `getWindowState` | `{ mode: 'full', alwaysOnTop: false, visible: true }` |
| מצבי "לא ידוע" כנים | `getWhatsappGuard` → `null` (=BLOCKED), ‏`getWhatsappGuardActivation` → `null`, ‏`getProviderEvidence` → `null`, ‏`getGoogleStatus` → `{ available: false, authenticated: false }`, ‏`probeCodexGrant` → `{ ok: false, reachable: false, message: 'not probed (test default)' }`, ‏`probeProvider` → `{ ok: false, reachable: false }`, ‏`getVersions` → `{}`, ‏`getRecentLogs` → `{ lines: [] }` | ה-parsers ה-fail-closed של האפליקציה (`interpretWhatsappGuard` וכו') כבר יודעים לתרגם אותם למצב "לא מוכח" |
| אירועים | `onRuntimeLog` | רושם callback ומחזיר unsubscribe אמיתי; `emitRuntimeLog` מפעיל |
| **כל השאר** — פעולות בעלות תופעות לוואי או קריאות ללא צורת-unknown בטוחה: `api`, `applyUpdate`, `installHermes`, `openFull`, `openExternal`, `chooseFile`, `chooseFolder`, `getCuratorInsights`, `getPartnerState`, `applyPartnerMode`, `startGoogleSetup`, `finishGoogleSetup`, `ensureGateway`, `getWhatsappPolicy`, `getWhatsappDirectory`, `setWhatsappPolicy`, `ensureWhatsappPolicy`, `recordProviderEvidence`, `createDiagnostics`, `setWindowMode`, `setAlwaysOnTop`, `hideWindow` | **reject** עם `new Error("hermes test bridge: <method> not stubbed")` — בדיקה שנוגעת בהן בלי stub מפורש נכשלת בקול (או מפעילה את מסלול ה-catch הכן של הקומפוננטה, שזה בדיוק מה שרוצים לבדוק) |

**רציונל:** ברירת מחדל happy-path הייתה מסתירה רגרסיות בדיוק במסלולים שהמוצר הזה בנוי סביבם (fail-closed בכל שכבה — ר' `useWhatsappGuard`, `useHermesData`, `health.ts`). ה-double משקף את אותה תורה.

### 4.3 שני מפלסי stub — כלל אצבע לכותב הבדיקה

- **מפלס א' (תמיד):** גשר ה-`window.hermesDesktop` — קובע זהות/מצב (`demo:false`, ‏`bridgeMissing:false`) ומשרת את כל מתודות ה-desktop.
- **מפלס ב' (פר-suite, לנתוני gateway):** ‏`vi.spyOn(hermesClient, 'listTasks')` וכו' על ה-singleton מ-`src/lib/hermes-client.ts` (המתודות הן מאפייני instance שהוצמדו ב-`Object.assign` — ניתנים ל-spy). ללא spy, קריאת RPC אמיתית תיכשל כי אין socket — שוב fail-closed כן, לא נתונים מומצאים.
- למודולים טהורים בעלי ורסיית I/O (`verifyBusinessContextPersisted` וכד') — ‏`vi.mock` חלקי עם `importActual`.

### 4.4 דפוסי בדיקה מחייבים

**אסינכרוניות:** ‏`await screen.findBy...` / ‏`await waitFor(...)` בלבד; אסור `setTimeout`/sleep שרירותי. אינטראקציות דרך `const user = userEvent.setup()` עם `await`.

**טיימרים (toasts):** ‏`vi.useFakeTimers()` ‏+ ‏`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`; קידום עם `act(() => vi.advanceTimersByTime(ms))`; ‏`vi.useRealTimers()` ב-afterEach של ה-suite.

**עברית/RTL:**
- Queries לפי role עם שם נגיש בעברית: `screen.getByRole('button', { name: 'סגור' })`, ‏`getByRole('dialog', { name: <title> })` — מחרוזות מדויקות המועתקות מהמקור (זהירות מגרש/גרשיים ׳/'), לא regex חלקי.
- ‏jsdom לא מחשב layout של RTL; בודקים **סמנטיקה**: ‏`document.documentElement.dir === 'rtl'` (בדיקת infra), ו-attributes מפורשים כמו ה-`dir="ltr"` של ה-`<pre>` ב-ErrorBoundary. יישור ויזואלי נשאר ל-E2E.

**גייט מודול-load (למשל `FORCE_ONBOARDING` ב-`App.tsx` שנקרא בזמן import):** קובעים URL עם `window.history.replaceState({}, '', '/?onboarding=1')`, ואז `vi.resetModules()` + ‏`await import('../App')` בתוך הבדיקה.

---

## 5. שינויי קונפיגורציה מדויקים

### 5.1 `vite.config.ts`

**אין שינוי חובה.** בלוק ה-`test` הקיים נשאר כמות שהוא. תוספת תיעוד בלבד:

```diff
     test: {
       exclude: [...configDefaults.exclude, '**/.claude/**', '**/promo-video/**'],
       testTimeout: 15000
+      // Component/hook tests live in src/**/*.test.tsx, opt into jsdom with a
+      // per-file `// @vitest-environment jsdom` docblock and import
+      // src/test/setup-dom as their FIRST import. Both are enforced by
+      // src/test/dom-conventions.test.ts. Default environment stays `node`
+      // (electron/*.test.ts, src/lib, scripts). Do NOT add environmentMatchGlobs
+      // (removed in Vitest 4) or test.projects (breaks the CLI --exclude flags
+      // that gate scripts/lib/evidence*.test.mjs out of `npm run test:unit`).
     }
```

### 5.2 `package.json`

```diff
   "devDependencies": {
+    "@testing-library/dom": "^10.4.1",
+    "@testing-library/jest-dom": "^6.9.0",
+    "@testing-library/react": "^16.3.0",
+    "@testing-library/user-event": "^14.6.1",
+    "jsdom": "^27.0.0",
```

```diff
     "test": "npm run test:unit",
     "test:unit": "vitest run --exclude scripts/lib/evidence.test.mjs --exclude scripts/lib/evidence-subject.test.mjs",
+    "test:components": "vitest run src/components src/hooks src/test src/App.test.tsx",
     "test:evidence": "vitest run scripts/lib/evidence.test.mjs scripts/lib/evidence-subject.test.mjs",
```

- `test`, `test:unit`, `test:evidence`, `verify:release` — **ללא שינוי**. בדיקות הקומפוננטות נכנסות אוטומטית ל-`test:unit` (הן חלק מ-include ברירת המחדל), ולכן גם ל-`verify:release`, בלי לגעת בזרימת ה-evidence.
- `test:components` הוא סינון-קבצים נוח לפיתוח מקומי בלבד; לא חלק משום gate.
- ה-`build.files` של electron-builder כבר מחריג `!**/*.test.{...tsx...}` — קובצי הבדיקה לא נארזים; יש לוודא ש-`src/test/**` אינו מגיע ל-bundle (הוא לא — אף מודול מוצר לא מייבא אותו; בדיקת ה-conventions אוכפת שרק `*.test.tsx` מייבאים מ-`src/test/`).

### 5.3 `tsconfig`

ללא שינוי. `tsc -b` (חלק מ-`build`) יטפל בקבצים החדשים תחת `include: ["src"]`; טיפוסי jest-dom מגיעים מה-import ב-`setup-dom` שנכלל בכל קובץ בדיקה.

---

## 6. מלאי קומפוננטות מדורג + מה כל suite חייב לכסות

הדירוג לפי (סיכון רגרסיה) × (ערך מוצר) × (ישימות ב-jsdom). **התנהגות בלבד — אין snapshots.**

### P1 — `src/components/ui/Modal.tsx` (ה-exemplar של שלב 1)
שכבת המודאלים כולה יושבת עליו; לוגיקת focus-trap ידנית = סיכון a11y גבוה. ללא תלות בגשר — מוכיח את תשתית ה-DOM בטהרתה.
- פוקוס נכנס בעת mount לאלמנט הראשון הניתן לפוקוס; כשאין — ל-section עצמו (`tabIndex={-1}`).
- החזרת פוקוס לאלמנט הקודם בעת unmount (`document.contains` guard).
- `Escape` קורא `onClose`; ‏Tab/Shift+Tab מסתובבים בתוך הדיאלוג (עטיפה בקצוות, בהתאם ל-`nextFocusIndex`).
- ‏mousedown על ה-backdrop בלבד סוגר; לחיצה בתוכן — לא.
- סמנטיקה: `role="dialog"`, ‏`aria-modal="true"`, ‏`aria-label` = ‏title, כפתור עם שם נגיש `סגור`.

### P2 — מערכת ה-toasts: `src/hooks/useToasts.ts` + רינדור `.floating-toast` ב-`FullAppShell.tsx`/`MiniShell.tsx`
לוגיקת מרוץ-טיימרים שנכתבה במפורש כדי לתקן race — חייבת שימור.
- ‏info נעלם אחרי `TOAST_DURATIONS_MS.info` (2500ms), ‏error אחרי 6000ms (fake timers).
- toast חדש מחליף ישן; הטיימר של הישן **לא** מוחק את החדש (ה-guard לפי id ב-`toastReducer`).
- `dismiss` מנקה מיידית; ‏unmount מנקה טיימר (ללא אזהרות act/דליפות).
- רינדור: ‏`role="status"`, ‏`aria-live="polite"`, אייקון error שונה מ-info (לפי `severity`).
- להשתמש ב-`resetToastSequence()` (‏`src/lib/toast.ts`) לפני כל בדיקה לדטרמיניזם.

### P3 — גייט onboarding/resume ב-`src/App.tsx`
הלוגיקה הקריטית ביותר שמוגדרת כ-fail-closed ואין לה שום כיסוי render.
- מצב פתיחה `resolving` → מוצג מסך "טוען את ההקשר של העסק…" (‏`role="status"`), לא האפליקציה ולא onboarding.
- ‏runtime עם `running:false` → מעבר ל-onboarding + מחיקת `hermes-business-onboarding-v1` מ-localStorage.
- ‏`verifyBusinessContextPersisted` (ב-`vi.mock` חלקי של `../lib/business-context`) שמחזיר `true` → ‏`ready` + כתיבת cache; ‏`false`/reject → onboarding + מחיקת cache.
- ‏`?onboarding=1` כופה onboarding (דפוס ה-dynamic-import מסעיף 4.4).
- ‏unmount באמצע resolve לא מעדכן state (דגל `alive`).
- ‏`useHermesData` נשען על ברירות המחדל ה-fail-closed של הגשר; ‏spies על ‏`hermesClient` רק במקום שנדרש נתון חיובי.

### P4 — `src/components/ErrorBoundary.tsx`
- ילד שזורק בזמן render → מסך הנפילה בעברית ("משהו השתבש"), ‏`console.error` נקרא (spy), הילד לא מוצג.
- ‏`<details>` מציג את פלט `formatErrorDetails` (message + stack), וה-`<pre>` נושא `dir="ltr"`.
- כפתור "רענון האפליקציה" קורא `window.location.reload` (spy/stub — jsdom לא מרענן).
- ללא שגיאה — children מרונדרים כרגיל.
- **בנוסף:** לעדכן את ההערה המיושנת בשורות 6–8 של הקובץ.

### P5 — פאנל הבריאות: `src/components/screens/support/SupportStatusPanel.tsx` (+ ‏`src/hooks/useWhatsappGuard.ts`)
צומת ה-fail-closed המרכזי מול המשתמש; מפעיל את הגשר דרך `getWhatsappGuard`.
- ‏hook: ‏`undefined` עד לתשובה; ‏reject → ‏`null`; ‏re-probe כש-`refreshKey` משתנה; אין setState אחרי unmount.
- פאנל: ‏runtime ‏null/עצור → רכיב במצב error (לא "הכול תקין"); ‏`errors.tasks/connections` → ‏"could not read" מוצג שונה מרשימה ריקה; ‏guard ‏null עם ערוץ WhatsApp מחובר → מצב לא-מוגן; ‏summary/`state-label--active` רק כשכל הרכיבים ok.

### P6 — UI תזמונים: `src/components/dialogs/ScheduleFields.tsx` (+ ‏`useScheduleTimezone`)
- החלפת mode ב-select בונה default נכון תוך שימור השעה (`scheduleDefault`).
- ‏weekly: ‏toggle ימים עם `aria-pressed`, קבוצת `role="group"` עם שם `ימים`.
- ‏once ללא תאריך → לא-valid (ההודעה/החסימה שהקומפוננטה מציגה); עם תאריך בפער DST → אזהרת `oneShotDstWarning` מוצגת.
- ‏advanced חושף שדה cron גולמי.

### P7 — `src/components/AppModalLayer.tsx` + ‏`src/components/AppModals.tsx`
- ניתוב `ModalKind` נכון (task/skill/provider/null) וסגירה.
- ‏`onConnect` של provider: הצלחה → ‏`recordProviderEvidence` (על הגשר) → ‏refresh → ‏toast הצלחה → סגירה; כישלון `connectProvider` → המודאל נשאר פתוח והשגיאה מוצגת.

### P8 — `src/components/OnboardingSurface.tsx` (גייט ההשלמה בלבד)
- ‏provider לא מאומת → ‏`complete` זורק את הודעת העברית ולא כותב כלום.
- ‏persist נכשל → אין `onFinished`, אין כתיבת localStorage.
- ‏persist הצליח אך `beginConversation` נכשל → ‏`onFinished({ introStarted: false })` ו-localStorage כן נכתב.

**מחוץ לתחום בשלב זה:** ‏`ChatScreen`/`useChat` (תלות transport כבדה), ‏`ConnectionModal` על תתי-זרימות WhatsApp (עדיף אחרי התייצבות התשתית), קומפוננטות תצוגה טהורות (`StatusPill`, `Logo`).

---

## 7. בדיקות של התשתית עצמה

### 7.1 `src/test/infra.test.tsx` (‏jsdom — עובר דרך אותה קונבנציה בעצמו)
1. `document.documentElement` נושא `dir="rtl"` ו-`lang="he"`.
2. ‏matcher של jest-dom פעיל (`expect(el).toBeInTheDocument()`).
3. הגשר מותקן: ‏`window.hermesDesktop` קיים, ‏`getRuntime()` resolves ל-`FAIL_CLOSED_RUNTIME`, ומתודת side-effect (למשל `applyUpdate()`) — ‏rejects עם `not stubbed`.
4. ‏`stubBridge` תופס לבדיקה אחת בלבד: בדיקה א' עושה override, בדיקה ב' מוודאת שחזרו ברירות המחדל (מוכיח את `resetBridge`).
5. ‏cleanup בין בדיקות: בדיקה מרנדרת div מסומן; הבדיקה שאחריה מוודאת `document.body` ריק.
6. זהות client: ‏import של `hermesClient` ואימות `demo === false && bridgeMissing === false` — הראיה שמלכודת ה-demo סגורה.

### 7.2 `src/test/dom-conventions.test.ts` (‏node — בדיקת lockstep בסגנון הריפו)
סורק עם `fs`/glob את העץ (בכיבוד ההחרגות `.claude`, ‏`node_modules`, ‏`promo-video`) ואוכף:
1. כל `src/**/*.test.tsx` מתחיל ב-`// @vitest-environment jsdom` (או צורת `/** */`) **בשורה הראשונה**.
2. ה-import הראשון בכל קובץ כזה הוא `src/test/setup-dom` (יחסית).
3. אין `*.test.tsx` מחוץ ל-`src/`.
4. אף קובץ תחת `electron/` או `scripts/` אינו מכיל `@vitest-environment jsdom`.
5. אף מודול שאינו `*.test.tsx`/`src/test/**` אינו מייבא מ-`src/test/` (מגן על ה-bundle).
6. קנרית סביבה: `typeof document === 'undefined'` — מוכיח שברירת המחדל נשארה node.

---

## 8. סיכונים ומגבלות (jsdom מול renderer אמיתי של Electron)

| סיכון | השלכה | מיטיגציה |
|---|---|---|
| jsdom בלי layout/CSS אמיתי | אין בדיקת נראות, RTL ויזואלי, גדלים; ‏class בלבד | בדיקות סמנטיות (roles/aria/dir); ויזואלי נשאר ל-`test:e2e:installed-ui` |
| הגשר האמיתי הוא preload חתום (sandbox, ‏contextBridge, נורמליזציית שגיאות IPC) | ה-double הוא **מודל**, לא החוזה | ‏`electron/preload.test.ts` נשאר הסמכות על preload; ה-double מוגדר מול הטיפוס `HermesDesktopBridge` כך ש-drift נתפס ב-`tsc` |
| מלכודת demo (‏DEV=true תחת vitest) | בדיקות ירוצו מול fixtures בלי לדעת | התקנת הגשר לפני imports + בדיקת 7.1(6) |
| ‏singleton ‏`hermesClient` לוכד מצב בזמן import | ‏override מאוחר של הגשר לא ישנה זהות | דלגציה פנימית ב-double; איסור החלפת האובייקט עצמו (מתועד בקובץ) |
| ‏fake timers מול user-event/waitFor | תלייה או אזהרות act | דפוס מחייב `advanceTimers` (סעיף 4.4) |
| ‏`test.projects` עתידי | שבירת evidence gating | הערת האזהרה בקונפיג (5.1) + בדיקת ה-conventions |
| האטת `npm test` | ‏verify:release ארוך יותר | jsdom רק בקובצי `.tsx` הבודדים; יעד: כל שכבת ה-DOM ‏≤ ‏15 שניות מקומית; ‏`test:evidence` לא נוגע ב-src כלל |
| ‏jsdom חסר APIs (‏matchMedia, ‏ResizeObserver) | כשלים בקומפוננטות עתידיות | להוסיף polyfill נקודתי ל-`setup-dom` רק כשנדרש בפועל, עם הערה |

---

## 9. שלבים וקריטריוני קבלה (מדורג ל-subagent ברמת Sonnet)

### שלב 1 — תשתית + exemplar (חייב להיסגר כיחידה אחת)
**תוצרים:** התקנת התלויות (5.2); ‏`src/test/setup-dom.ts`; ‏`src/test/hermes-bridge.ts`; ‏`src/test/infra.test.tsx`; ‏`src/test/dom-conventions.test.ts`; ‏`src/components/ui/Modal.test.tsx` (כיסוי P1 המלא); הערת הקונפיג (5.1); סקריפט `test:components`.
**קבלה:**
1. `npm run test:unit` ירוק; מספר קובצי הבדיקה = הקודם + 4 בדיוק.
2. `npm run test:evidence` מריץ **בדיוק** את שני קובצי ה-evidence, ירוק, ללא שינוי זמן מהותי.
3. `npx vitest run electron` ירוק ובסביבת node (קנרית 7.2(6) עוברת).
4. `npx tsc -b` נקי; ‏`npm run build` נקי; אין `src/test` ב-`dist/`.
5. כל הקריטריונים של 7.1 ו-7.2 ממומשים כבדיקות עוברות.

### שלב 2 — צומתי fail-closed
**תוצרים:** ‏`useToasts.test.tsx` (P2, כולל רינדור ה-toast ב-`FullAppShell`), ‏`ErrorBoundary.test.tsx` (P4 + עדכון ההערה המיושנת), ‏`useWhatsappGuard.test.tsx` + ‏`SupportStatusPanel.test.tsx` (P5).
**קבלה:** כל התרחישים המנויים בסעיף 6 לכל suite; ‏`test:unit` ירוק; אין אזהרות act בפלט.

### שלב 3 — גייטים כבדים
**תוצרים:** ‏`App.test.tsx` (P3, דפוס dynamic-import), ‏`ScheduleFields.test.tsx` (P6), ‏`OnboardingSurface.test.tsx` (P8).
**קבלה:** תרחישי סעיף 6; זמן שכבת ה-DOM כולה ‏≤ 15 שניות מקומית.

### שלב 4 (רשות) — שכבת מודאלים מלאה
**תוצרים:** ‏`AppModalLayer.test.tsx` (P7), ותחילת `ConnectionModal`.
**קבלה:** תרחישי P7; ‏`verify:release` ירוק מקצה לקצה.

---

## נספח: קבצים קריטיים למימוש
- `vite.config.ts`
- `package.json`
- `src/vite-env.d.ts` (הטיפוס `HermesDesktopBridge` שה-double ממומש מולו)
- `src/lib/hermes-client.ts` (ה-singleton ומלכודת ה-demo שה-setup חייב להקדים)
- `src/components/ui/Modal.tsx` (ה-exemplar של שלב 1)
