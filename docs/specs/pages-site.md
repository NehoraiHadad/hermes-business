# אפיון: אתר GitHub Pages ציבורי לתכל'ס (Tachles)

**מסמך:** `docs/specs/pages-site.md`
**תאריך:** 2026-08-03 | **גרסת אפליקציה בעת הכתיבה:** `0.4.0-alpha.1` | **ריפו:** `github.com/NehoraiHadad/hermes-business` (ברירת מחדל: `master`)
**כתובת האתר הצפויה:** `https://nehoraihadad.github.io/hermes-business/`

---

## 0. חסם מקדים שחייב החלטת משתמש — נראוּת הריפו (Visibility)

בדיקה בפועל (`gh repo view --json visibility`) מראה שהריפו כיום **PRIVATE**.

עובדות, בלי ייפוי:

1. **GitHub Pages על ריפו פרטי דורש תוכנית בתשלום** (Pro/Team/Enterprise). בחשבון אישי חינמי — Pages זמין רק לריפו ציבורי.
2. **גם GitHub Releases בריפו פרטי אינם נגישים לציבור** — קישורי `/releases/latest` ידרשו התחברות. כלומר גם אם האתר יעלה (בתשלום), כפתור "הורדה" יוביל ל-404 עבור מבקר אנונימי.
3. גם `COMPANION_MANIFEST_URL` הציבורי העתידי (סעיף 7) חסום מאותה סיבה.

**האפשרויות (המשתמש מכריע, לא הסוכן):**

| אפשרות | משמעות |
|---|---|
| א. להפוך את הריפו לציבורי | פותר הכול (Pages + Releases + manifest). דורש ודאות שאין סודות בהיסטוריית git ושרישוי הקוד מקובל על המשתמש |
| ב. ריפו ציבורי נפרד ורזה (למשל `tachles-site`) שמכיל רק את האתר + Releases להפצה | שומר את קוד המקור פרטי; מוסיף ריפו לתחזוקה; ה-workflow באפיון זה עובר כמעט כמו-שהוא |
| ג. תוכנית בתשלום + ריפו נשאר פרטי | פותר רק את האתר; **לא** פותר הורדות ציבוריות — לא ממליץ |

**האפיון להלן כתוב לאפשרות א׳** (הפשוטה והזולה); סעיף 12 מפרט את הדלתא הנדרשת לאפשרות ב׳. שום שלב ביצוע לא מתחיל לפני שהמשתמש בחר.

---

## 1. מטרות ולא-מטרות

### מטרות
- עמוד מידע ציבורי, מקצועי, בעברית RTL מלאה, שמסביר: מה זה תכל'ס, איך זה יושב מעל Hermes, מה פילוסופיית ה-local-first, איך מתקינים על Windows, ומה מצב הבשלות (Alpha, לא חתום).
- **כנות רדיקלית:** האתר אומר במפורש שהמתקין אינו חתום, ש-SmartScreen צפוי, ושהמוצר הוא Alpha לפיילוט — באותה רוח של ה-README וה-evidence pipeline הקיימים.
- קישור "הורדת הגרסה האחרונה" דרך redirect של GitHub Releases — **בלי** לקבע מספר גרסה בקוד האתר.
- תשתית deployment (GitHub Actions → Pages) שמבודדת לחלוטין מצנרת ה-release/evidence הקיימת.
- הכנת "וו" עתידי ל-`COMPANION_MANIFEST_URL` (סעיף 7) — האתר מקשר, לא מארח בינארים.

### לא-מטרות
- לא Vercel, לא Netlify, לא CDN בתשלום — הוחלט GitHub Pages בגלל guardrails של עלות. **אין לחרוג.**
- לא אפליקציה: אין framework‏ (React/Next/Astro), אין bundler, אין build step. עמוד מידע.
- לא אירוח בינארים באתר — קבצי התקנה חיים ב-GitHub Releases בלבד.
- לא אנליטיקס, לא פונטים מ-CDN חיצוני, לא סקריפטים צד-שלישי — עקבי עם מסר הפרטיות של המוצר.
- לא דומיין מותאם (אפשר להוסיף בעתיד; מחוץ לאפיון).
- לא תרגום לאנגלית בשלב זה (עמוד עברי יחיד; מבנה הקבצים לא חוסם `en/` עתידי).
- לא נגיעה ב-`docs/` — הוא שייך לתיעוד הנדסי (`release-contract.md`, `evidence/` וכו').

---

## 2. ארכיטקטורת תוכן — עמוד יחיד עם עוגנים

עמוד יחיד (`index.html`) עם ניווט עוגנים, כי כמות התוכן קטנה ועמוד יחיד מקצועי עדיף על 6 עמודים דלילים. סדר הסקשנים:

| # | סקשן | `id` (עוגן) |
|---|---|---|
| 1 | Hero — מה זה תכל'ס | `top` |
| 2 | איך זה עובד — היחס ל-Hermes | `how` |
| 3 | פרטיות — local-first | `privacy` |
| 4 | מה צריך — דרישות | `requirements` |
| 5 | התקנה על Windows (כולל SmartScreen) | `install` |
| 6 | הורדות | `download` |
| 7 | שאלות נפוצות | `faq` |
| 8 | יצירת קשר + footer | `contact` |

### 2.1 טיוטת הטקסט המרכזי (עברית; לשימוש כבסיס — מותר ליטוש, אסור לשנות עובדות)

**Hero:**
> # תכל'ס
> ### שותף עסקי על שולחן העבודה. הנתונים שלך נשארים אצלך.
>
> תכל'ס הוא מעטפת ידידותית מעל סוכן Hermes שמותקן אצלך במחשב: חלון קטן וזמין תמיד, בעברית, שהופך את הסוכן לעוזר עסקי — מעקב הודעות, משימות, חיבורים ותזכורות — בלי שהמידע העסקי שלך עוזב את המחשב.
>
> [כפתור: הורדה ל-Windows (Alpha)] [קישור משני: איך זה עובד?]
>
> _גרסת Alpha — מיועדת לפיילוט. המתקין אינו חתום עדיין; ראו "התקנה"._

**איך זה עובד (`how`):**
> ## שכבה דקה, לא סוכן חדש
> תכל'ס לא ממציא סוכן משלו. הוא עובד מעל התקנת Hermes רשמית אחת, ומשתמש בדיוק באותם פרופיל, שיחות, זיכרון, Skills, חיבורים ומשימות. כל מה שתעשו בתכל'ס ייראה גם ב-Hermes המלא — ולהפך.
>
> - **Companion** — חלון צ'אט קטן, זמין תמיד, עם מזעור, הצמדה ו-Tray.
> - **Plugin** — מסך עסקי ידידותי בתוך Hermes Desktop המלא.
>
> אין כאן Agent Runtime חלופי, אין זיכרון כפול ואין מנוע נפרד. אם Hermes לא מותקן — תכל'ס יודע להתקין אותו דרך המנגנון הרשמי, בלי Terminal.

**פרטיות (`privacy`):**
> ## הנתונים שלך לא עוזבים את המחשב
> - תכל'ס רץ מקומית. שיחות, הודעות, קבצים והגדרות נשמרים אצלך, בבית של Hermes על המחשב שלך.
> - האתר הזה סטטי לחלוטין: אין אנליטיקס, אין עוגיות, אין פונטים או סקריפטים משרתים חיצוניים.
> - חיבורים חיצוניים (Google, Telegram, WhatsApp) עוברים אך ורק דרך המנגנונים הרשמיים של Hermes, ורק אם חיברתם אותם בעצמכם.
> - מדיניות WhatsApp היא fail-closed: ברירת המחדל היא קריאה בלבד, ומענה אוטומטי מופעל רק לשיחות שבחרתם במפורש.

**דרישות (`requirements`):**
> ## מה צריך
> - Windows 10/11, ‏64-bit.
> - סוכן Hermes בטווח תאימות `>=0.19.0 <0.20.0` — אם אינו מותקן, המתקין יציע להתקין אותו.
> - חשבון אצל ספק מודל (למשל OpenAI) המחובר דרך מנגנון ההגדרה של Hermes.
> - חיבורי Google/Telegram/WhatsApp — אופציונליים, ודורשים הרשאות שאתם נותנים במפורש.

**התקנה (`install`):**
> ## התקנה על Windows — ובכנות מלאה
> 1. מורידים את המתקין מעמוד ההורדות (קישור למטה).
> 2. **צפוי מסך SmartScreen כחול:** גרסת ה-Alpha עדיין אינה חתומה בחתימת קוד (code signing). זה מתוכנן ויתוקן לפני גרסת production. אם אתם ממשיכים: "More info" ← "Run anyway". אנחנו לא מבקשים מכם "לסמוך עלינו בעיניים עצומות" — לכל release מצורף קובץ `SHA256SUMS.txt` לאימות שלמות הקובץ, וכל הקוד פתוח לעיון בריפו.
> 3. ההתקנה היא per-user, יוצרת קיצורי Desktop ו-Start Menu, ובהפעלה ראשונה מזהה או מתקינה Hermes תואם.
>
> _אימות ידני (אופציונלי): `Get-FileHash .\תכל'ס*.exe -Algorithm SHA256` והשוואה ל-`SHA256SUMS.txt` שבאותו release._

**הורדות (`download`):**
> ## הורדה
> [כפתור ראשי → `https://github.com/NehoraiHadad/hermes-business/releases/latest`]
> כל הגרסאות, קבצי ה-checksums והערות ה-release נמצאים ב-GitHub Releases. האתר הזה לא מארח קבצים — מקור אמת אחד.
> _סטטוס נוכחי: Alpha ‏(`0.4.x`). לא מוצר production; רשימת הפערים הפתוחים מתועדת ב-README של הריפו._

**FAQ (`faq`)** — פורמט `<details>` נטיבי (בלי JS):
> - **האם תכל'ס מחליף את Hermes?** לא. הוא דורש Hermes ומרחיב אותו.
> - **למה Windows מציג אזהרה בהתקנה?** כי המתקין עדיין לא חתום. ראו סעיף ההתקנה.
> - **האם המידע שלי נשלח לענן שלכם?** אין לנו ענן. אין לנו שרת. הכול מקומי; קריאות למודל עוברות דרך הספק שאתם חיברתם ל-Hermes.
> - **כמה זה עולה?** תכל'ס עצמו — בחינם בשלב ה-Alpha. עלות השימוש במודל היא מול הספק שלכם.
> - **מצאתי באג — לאן פונים?** Issue בריפו, או במייל שבתחתית העמוד.
> - **האם יש גרסה ל-Mac/Linux?** לא בשלב זה.

**Footer (`contact`):**
> תכל'ס · Alpha · [GitHub] · [Releases] · [דיווח על תקלה — Issues] · nehorai.hadad@gmail.com
> נבנה מעל Hermes Agent. תכל'ס אינו מוצר רשמי של Hermes.

---

## 3. החלטת Tooling — מנומקת

**החלטה: zero-build. HTML + CSS סטטיים, ללא JS (או JS מזערי אופציונלי), ללא generator, ללא dependencies.**

נימוקים:
1. זהו עמוד מידע יחיד. כל generator ‏(Astro/Eleventy/Jekyll) מוסיף `node_modules`/Ruby, קבצי config, ו-build step ב-CI — עלות תחזוקה קבועה תמורת אפס ערך בעמוד אחד.
2. הריפו כבר עמוס צנרת (‏60+ סקריפטי npm, evidence pipeline). כל תלות חדשה = משטח שבירה חדש ו-audit נוסף. zero-build ⇒ ה-workflow הוא "העלה תיקייה" ותו לא.
3. RTL בעברית עובד מצוין ב-HTML נקי: `<html dir="rtl" lang="he">` + logical properties ב-CSS (דפוס שכבר אומץ בקוד המוצר — משימה 5.2 בתוכנית השיפור).
4. עקביות מסר: אתר שמטיף local-first ומביא React מ-CDN הוא אירוניה. סטטי טהור = אפס בקשות צד-שלישי, ציון Lighthouse מלא, וטעינה מיידית במובייל.
5. JS מותר רק לשיפור פרוגרסיבי אחד אופציונלי (Phase 3): `fetch` ל-`api.github.com/repos/.../releases/latest` כדי להציג את מספר הגרסה ליד כפתור ההורדה. בלי JS — הכפתור עדיין עובד (redirect). **אסור** ש-JS יהיה תנאי לתוכן כלשהו.

---

## 4. מבנה קבצים מדויק

`docs/` תפוס לתיעוד הנדסי ⇒ תיקיית `site/` בשורש הריפו, נפרסת כפי-שהיא כ-artifact.

```text
site/
├── index.html          # העמוד המלא, עברית, dir="rtl" lang="he"
├── style.css           # כל העיצוב; CSS custom properties לפלטת המותג
├── site.webmanifest    # שם + אייקונים (PWA-lite למסך מובייל; לא service worker)
├── robots.txt          # User-agent: * / Allow: /
├── .nojekyll           # מנטרל את Jekyll processing של Pages
└── assets/
    ├── logo.png        # עותק של assets/tahlas-ai-business-logo.png (מוקטן/ממוטב)
    ├── avatar.png      # עותק של assets/tahlas-chat-avatar.png
    ├── favicon.ico     # עותק של build/icon.ico
    ├── icon-192.png    # נגזרת של build/icon.png
    ├── icon-512.png    # נגזרת של build/icon.png
    └── og-image.png    # תמונת שיתוף 1200×630 (לוגו על רקע canvas)
.github/
└── workflows/
    └── pages.yml       # ה-workflow היחיד בריפו (אין .github/workflows כיום — נוצר מאפס)
```

הערות:
- הנכסים **מועתקים** לתוך `site/assets/` (לא נטענים בנתיב יחסי אל מחוץ ל-`site/`), כי ה-artifact ל-Pages הוא `site/` בלבד.
- `<head>` חובה: `charset=utf-8`, `viewport`, `description`, `og:title/description/image/locale=he_IL`, `twitter:card`, `theme-color` (‏`#7367df`), favicon + manifest links. `og:image` חייב URL אבסולוטי (`https://nehoraihadad.github.io/hermes-business/assets/og-image.png`).
- כל הקישורים הפנימיים יחסיים (project page יושב תחת `/hermes-business/` — אסור נתיבי `/` אבסולוטיים).

---

## 5. עיצוב ה-Workflow ‏(`.github/workflows/pages.yml`)

עקרונות בידוד: כיום **אין** אף workflow בריפו — צנרת ה-release/evidence כולה מקומית (npm scripts). ה-workflow החדש חייב להישאר היחיד שנוגע ב-Pages ולא להריץ שום סקריפט מהריפו (`npm`/`node` — כלום). zero-build פירושו checkout → upload → deploy.

```yaml
name: Deploy Pages site

on:
  push:
    branches: [master]
    paths:
      - "site/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: github-pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

נקודות עיצוב מחייבות:
- `paths` scoping ⇒ push של קוד מוצר/סקריפטים **לעולם לא** מפעיל deploy; ה-workflow רץ רק על שינוי ב-`site/` או בעצמו.
- `permissions` מינימליות ברמת ה-workflow; אין `contents: write` — ה-workflow לא יכול לגעת בריפו, ב-tags או ב-releases.
- אין step של `npm install`/`npm run` — אפס אינטראקציה עם ‏`package.json`, ‏evidence, ‏`verify:release-contract`.
- pinning: מותר להצמיד ל-SHA מלא במקום `@vN` (הקשחה אופציונלית, עקבית עם רוח `release-contract-hardening.md`).

---

## 6. RTL, טיפוגרפיה ומיתוג

### פלטה — לשימוש חוזר מזהות המותג הקיימת (מקור: `promo-video/src/theme.ts`)

```css
:root {
  --ink: #202039;        /* טקסט ראשי */
  --muted: #6f7087;      /* טקסט משני */
  --purple: #7367df;     /* מותג ראשי, כפתור CTA */
  --purple-dark: #5145bd;/* hover / דגש */
  --purple-soft: #eeeaff;/* רקעי הדגשה */
  --mint: #2bbf96;       /* הצלחה / "עובד" */
  --amber: #f1a448;      /* אזהרות (SmartScreen callout) */
  --amber-soft: #fff2dc; /* רקע callout אזהרה */
  --rose: #e76d8b;       /* אקצנט */
  --line: #e9e7f0;       /* גבולות */
  --paper: #fffefb;      /* רקע כרטיסים */
  --canvas: #f5f2ea;     /* רקע עמוד */
}
```

### RTL וטיפוגרפיה
- `<html dir="rtl" lang="he">`; **אין** לערבב `direction` פר-אלמנט. קטעי קוד/פקודות PowerShell עטופים `<code dir="ltr">`.
- CSS ב-logical properties בלבד (`margin-inline-start`, `padding-inline`, `text-align: start`) — אותו סטנדרט שהוחל על CSS המוצר.
- פונט: system stack עם עדיפות עברית — `font-family: "Segoe UI", "Noto Sans Hebrew", Arial, sans-serif;` (תואם ל-`theme.ts`). **בלי** Google Fonts CDN — סתירה למסר הפרטיות. אופציונלי: self-host של `NotoSansHebrew` variable woff2 יחיד תחת `site/assets/fonts/` עם `font-display: swap`.
- הברנד "תכל'ס" תמיד עם גרש עברי (׳/'), אף פעם לא בתעתיק לטיני בטקסט הגלוי.
- מובייל: עמודה אחת עד ‏`48rem`, ‏`max-inline-size: 68rem` ל-container, כפתור CTA ברוחב מלא במובייל, גדלי טקסט ב-`clamp()`.
- Callout ה-SmartScreen מעוצב כאזהרה (`--amber-soft` + פס `--amber`) עם `role="note"` — בולט אך לא מפחיד.
- נגישות: ניגודיות AA (‏`--muted` על `--canvas` נבדק), `:focus-visible` מוגדר, ניווט עוגנים ב-`<nav aria-label="ניווט">`, `<details>` ל-FAQ (נגיש נטיבית), `prefers-reduced-motion` מכובד אם יש אנימציה.

---

## 7. הוו העתידי — companion manifest ו-"latest"

### 7.1 היכן יחיה ה-manifest — **החלטה: GitHub Releases asset, לא Pages**

חוזה ה-manifest כבר קיים ומאומת ב-`installer/lib/CompanionManifest.ps1`: JSON עם `version`, ‏`url` (HTTPS חובה), ‏`sha256` (‏64 hex חובה), ‏`format` (‏`nsis`|`zip`), ‏`entrypoint` — ונאכף טווח תאימות מול גרסת ה-bootstrap.

| קריטריון | Releases asset (נבחר) | Pages-hosted JSON |
|---|---|---|
| אטומיות עם הבינארי | ה-manifest וה-exe מתפרסמים באותו release — לא ייתכן manifest שמצביע על קובץ שלא הועלה | דורש סנכרון בין release ל-deploy של האתר — חלון race מובנה |
| URL יציב | `https://github.com/NehoraiHadad/hermes-business/releases/latest/download/companion-release.json` — redirect רשמי, HTTPS, קבוע לעד | תלוי בקיום האתר וב-branch |
| הפרדת אחריות | ההפצה כולה ב-Releases (ההחלטה שכבר התקבלה) | מערבב "אתר מידע" עם "צנרת הפצה" |
| Cache | ללא CDN cache בעייתי | Pages CDN עשוי להגיש manifest ישן עד 10 דק' — מסוכן לצנרת checksum |

⇒ ערך ה-`COMPANION_MANIFEST_URL` העתידי: `https://github.com/NehoraiHadad/hermes-business/releases/latest/download/companion-release.json`. פרסום ה-asset הוא באחריות תהליך ה-release (מחוץ לאפיון זה); האתר **לא** מזכיר את ה-URL הזה למשתמש קצה — הוא פנימי למתקין הרשת.

### 7.2 "הורדת הגרסה האחרונה" באתר — בלי גרסאות מקובעות
- כפתור ההורדה מקשר ל-`https://github.com/NehoraiHadad/hermes-business/releases/latest` (redirect רשמי של GitHub) — לעולם לא לקובץ exe ספציפי, כי שם הקובץ נושא גרסה (וגם מכיל עברית — בעיית URL-encoding שעוד סיבה לא לקבע).
- שיפור פרוגרסיבי (Phase 3, אופציונלי): JS מזערי שמושך `GET https://api.github.com/repos/NehoraiHadad/hermes-business/releases/latest` ומציג `tag_name` ליד הכפתור; כישלון fetch ⇒ שקט מוחלט, הכפתור נשאר תקין.

---

## 8. מה דורש את המשתמש (לא אוטומטיזציה)

1. **הכרעת visibility** (סעיף 0) — ואם אפשרות א׳: `gh repo edit --visibility public` אחרי סריקת היסטוריה לסודות והחלטת רישוי (כיום `"private": true` ואין קובץ LICENSE — לפרסום ציבורי מומלץ להוסיף רישיון מפורש).
2. **הפעלת Pages:** Settings → Pages → Source: **GitHub Actions** (חובה ידנית; בלי זה ה-workflow ייכשל ב-`configure-pages`).
3. **Release ציבורי ראשון:** כדי שכפתור `/releases/latest` יעבוד — יצירת release עם המתקין + `SHA256SUMS.txt` (בהתאם ל-`docs/release-contract.md`; מחוץ לאפיון זה).
4. אישור טיוטת הטקסט השיווקי (סעיף 2.1) ובחירת כתובת הקשר (נמצא: `nehorai.hadad@gmail.com`).

---

## 9. סיכונים

| סיכון | חומרה | טיפול |
|---|---|---|
| הריפו יישאר פרטי ⇒ אין Pages ואין הורדות ציבוריות | חוסם | סעיף 0 — אין התחלת ביצוע לפני הכרעה |
| הפיכה לציבורי חושפת היסטוריית git (סודות, נתוני בדיקה) | גבוה | סריקה (`gh secret`, ‏gitleaks או סקירה ידנית של `docs/evidence/`, ‏`build/*.json`) לפני המעבר |
| `/releases/latest` מחזיר 404 עד שקיים release ראשון | בינוני | ה-copy בעמוד ההורדות מציין "גרסת Alpha ראשונה בדרך" עד אז; או דחיית ה-deploy עד ל-release |
| שם קובץ המתקין בעברית (`תכל'ס Setup ....exe`) בעייתי ב-URL של asset | בינוני | לא מקשרים ישירות ל-asset (רק לעמוד ה-release); לשקול שם ASCII ל-asset בצנרת ה-release (מחוץ לאפיון) |
| ה-workflow החדש "ידבק" לצנרת קיימת | נמוך | אין workflows קיימים; `paths` scoping + אפס הרצת סקריפטים |
| הצהרות פרטיות באתר חזקות מהמציאות | נמוך | הטקסט בסעיף 2.1 נוסח צמוד ל-README (fail-closed, ספק מודל חיצוני מוזכר במפורש) |
| Pages CDN מגיש גרסה ישנה של העמוד אחרי deploy | נמוך | קביל לעמוד מידע; אין לוגיקת גרסאות בעמוד עצמו (הכול redirect) |

---

## 10. שלבי ביצוע — ממודלי לסוכן ברמת Sonnet

### Phase 0 — הכרעות משתמש (ידני, חוסם)
בחירת visibility (סעיף 0), אישור copy, אישור המייל. **קריטריון קבלה:** תשובה מפורשת בכתב על שלוש ההכרעות.

### Phase 1 — שלד האתר
יצירת `site/` המלא לפי סעיף 4: ‏`index.html` עם כל 8 הסקשנים והטקסט מסעיף 2.1, ‏`style.css` עם הפלטה מסעיף 6, העתקת נכסים מ-`assets/` ו-`build/icon.*` לתוך `site/assets/`, ‏`.nojekyll`, ‏`robots.txt`, ‏`site.webmanifest`.
**קריטריוני קבלה:** (א) פתיחת `site/index.html` ישירות בדפדפן (file://) מציגה עמוד תקין — הוכחת zero-build; (ב) אין אף בקשת רשת חיצונית מלבד קישורים (בדיקה ב-DevTools Network); (ג) `dir="rtl" lang="he"` על `<html>`; (ד) כל הקישורים הפנימיים יחסיים; (ה) callout ה-SmartScreen קיים ומכיל את המילים "אינו חתום"; (ו) העמוד קריא ברוחב 375px.

### Phase 2 — Workflow ו-deploy
יצירת `.github/workflows/pages.yml` לפי סעיף 5 בדיוק. המשתמש מפעיל Pages (סעיף 8.2), ואז push/`workflow_dispatch`.
**קריטריוני קבלה:** (א) ה-run ירוק וה-URL עולה; (ב) push שמשנה רק `README.md` **לא** מפעיל את ה-workflow (אימות ה-`paths` scoping); (ג) `npm test` בריפו עובר ללא שינוי — הוכחה שלא נגענו בצנרת; (ד) `https://nehoraihadad.github.io/hermes-business/` נטען עם favicon, og-tags ו-RTL תקינים.

### Phase 3 — ליטוש (אופציונלי, לא חוסם)
JS מזערי לגרסה האחרונה (סעיף 7.2) עם graceful degradation; ‏`og-image.png` ייעודי; self-host פונט אם הטיפוגרפיה של system stack לא מספקת.
**קריטריוני קבלה:** (א) חסימת `api.github.com` ב-DevTools לא שוברת שום דבר נראה; (ב) Lighthouse: ‏Accessibility ≥ 95, ‏Best Practices ≥ 95.

### Phase 4 — וו ה-manifest (עתידי; מחוץ לאתר)
כשצנרת ה-release תפרסם `companion-release.json` כ-asset, קיבוע `COMPANION_MANIFEST_URL` לכתובת מסעיף 7.1 ואימות מול `Read-CompanionRelease`/`Assert-CompanionRelease`. האתר אינו משתנה.

---

### קבצים קריטיים למימוש
- `site/index.html` (חדש — העמוד עצמו)
- `site/style.css` (חדש — עיצוב RTL ופלטת המותג)
- `.github/workflows/pages.yml` (חדש — ה-deploy)
- `promo-video/src/theme.ts` (מקור פלטת המותג והפונט)
- `installer/lib/CompanionManifest.ps1` (חוזה ה-manifest לוו העתידי)
- `README.md` (מקור האמת לעובדות המוצר וניסוח הכנות על unsigned/SmartScreen)
