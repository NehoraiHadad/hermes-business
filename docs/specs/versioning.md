# אפיון: ניהול גרסאות ועדכון־עצמי של תכל'ס (Companion Versioning & Self-Update)

מסמך יעד: `docs/specs/versioning.md` | גרסת אפיון: 1.0 | תאריך: 2026-08-03
היקף: הקומפניון (תכל'ס) בלבד. עדכון hermes-agent **כבר מטופל** ואינו בהיקף המסמך.

---

## 1. רקע — המצב הקיים (עם ראיות)

### 1.1 שני משטחי עדכון — רק אחד מחווט

`docs/ACCEPTANCE.md:125-144` ("Update responsibility") קובע במפורש:

- **Hermes agent** — עדכון־עצמי מחווט ומוקשח: `electron/hermes-update-flow.cjs` מריץ `preflight → journal → stop → backup → mutate → recover → verify → clear`, עם journal עמיד (`electron/hermes-update-journal.cjs` + `update-journal-store.cjs`), rollback ל־anchor מאומת, ו־re-gate של תאימות לפני דיווח הצלחה. **זה הדפוס שממנו שואבים, לא מה שמשנים.**
- **תכל'ס עצמו — לא מחווט.** אין תלות ב־`electron-updater`, אין צרכן `autoUpdater`, `build.publish` הוא `null` (`package.json:93`), וגרסה חדשה מגיעה בהרצה ידנית של installer.

### 1.2 מדוע קיים שלב verify-no-update-metadata — ומה בדיוק הוא בודק

`scripts/package-win.mjs:58` מריץ את `scripts/verify-no-update-metadata.mjs` על `release/` אחרי אריזת ה־NSIS. הסקריפט (שורות 2-18) סורק רקורסיבית ומפיל את ה־build אם נמצא קובץ התואם ל:

```js
export const UPDATE_METADATA_RE = /^(latest(-[a-z0-9]+)?\.yml|app-update\.yml)$/i   // שורה 18
```

**הרציונל (מתועד בראש הסקריפט וב־ACCEPTANCE.md:135-144):** האפליקציה לא מכילה צרכן עדכונים, ולכן פליטה של `latest.yml`/`app-update.yml` הייתה **מצג שווא של יכולת עדכון־עצמי שאינה קיימת** — artifact מטעה, לא הגנה על יכולת אמיתית. השלב הוא backstop fail-closed ל־`build.publish: null`. מסקנה מחייבת: **כל עוד לא נבנה צרכן עדכונים אמיתי, השלב נשאר; אם וכאשר יחווט electron-updater (עידן חתימה), ביטולו הוא שינוי חוזה מכוון ומתועד — לא "מחיקה של בדיקה מציקה".** האפיון הנוכחי (בדיקת גרסה + הורדה ידנית) **אינו דורש** metadata של updater, ולכן השלב נשאר על כנו ללא שינוי.

### 1.3 מה חוזה ה־release כבר כובל (לא לשכפל!)

| כריכה קיימת | היכן | מה נאכף |
|---|---|---|
| version → שם artifact | `scripts/lib/release/artifact-set.mjs:14-15` | `expectedInstallerName = "${productName} Setup ${version}.exe"`; בדיוק installer אחד, שם בר־פירסום, גרסה שנפרסה חייבת להשתוות ל־`package.json` (שורות 39-58) |
| version → attestation → binding digest | `scripts/lib/release/binding.mjs:44-63` | `computeReleaseBinding` כולל `attestation.app_version`, hashes של installers ו־`commit_fingerprint` (SHA + subject line, שורות 14-18) |
| manifest בתוך ה־payload ↔ report ↔ בייטים | `docs/release-contract.md` §Binding chain | `release_binding_digest = sha256(manifest_digest ∥ installers)`, כולל הוכחת containment |
| אי־שימוש חוזר בגרסה | `scripts/lib/release/prior-ledger.mjs` | ledger עמיד `{source: 'signed-ledger'\|'github-asset', entries: {version: {sha256}}}`; ציבורי **נכשל סגור** בלעדיו (`version-ledger-unavailable`), ו־`version-reuse` על בייטים שונים לאותה גרסה |
| ערוצי pipeline | `scripts/package-win.mjs:42-67` | `qa` בונה עם `build:qa` (demo transport), לא חותם (`finalize-payload.mjs:51-53`); `public` דורש חתימה + מלוא הראיות. promotion תמיד אחרון |
| ראיות כבולות ל־build | `docs/evidence/README.md` | `packaged-e2e` חייב `build_nonce`/`release_binding_digest`/`installer_sha256` של ה־build הזה |

**מקור אמת יחיד לגרסה קיים כבר היום: `package.json` (`"version": "0.4.0-alpha.1"`, שורה 3).** כל שרשרת הכריכה נגזרת ממנו. האפיון לא ממציא מקור חדש — הוא מוסיף שתי חוליות חסרות: **git tag** ו־**GitHub Release**.

### 1.4 מה חסר / שבור היום

1. **אין אף git tag** (`git tag -l` ריק) — אין עוגן ציבורי לגרסה שפורסמה.
2. **אין GitHub Release** — ולכן אין ledger מסוג `github-asset`, ומשטח `public` נכשל סגור על `version-ledger-unavailable` (נכון בעיצוב — אך פתרונו הוא בדיוק פרסום ל־GitHub Releases).
3. **ה־UI משקר בניגוד לדוקטרינה**: `src/components/screens/support/SupportUpdatePanel.tsx:35-39` מציג לשורת "Hermes לעסק" את המחרוזת הקבועה `'מעודכן'` ואת fallback `'0.1.0'` — טענת עדכניות ללא שום בדיקה. זו הפרה ישירה של עקרון ה־fail-closed שהמסך עצמו מיישם עבור Hermes (`'לא נבדק'` כברירת מחדל, שורה 32) ושל `useSupportActions.ts:109` ("`לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.`").
4. **שם ה־installer עברי** (`תכל'ס Setup 0.4.0-alpha.1.exe`) — בעייתי כ־asset ב־GitHub Releases (ראו סיכון R2 והחלטה D3).

### 1.5 עלות ראיות בכל bump גרסה (רמז הזיכרון — מאומת)

"Version bumps invalidate version-bound evidence envelopes" — מאומת משני כיוונים:

- **Subject fingerprint**: `package.json` נמצא ב־`PACKAGED_INPUTS` (`scripts/lib/subject-registry.mjs:64` — `PACKAGING_CONFIG = [{ file: 'package.json' }]`), ולכן bump מפסיל את `packaged-e2e` (`EVIDENCE_SUBJECTS['packaged-e2e'] = PACKAGED_INPUTS`, שורה 196).
- **כלל ה־provenance** (`docs/evidence/README.md:158-166`): מעטפה `committed` נשארת תקפה רק אם כל הקומיטים מאז `git_head` נוגעים **אך ורק** ב־`docs/evidence/*.json`. קומיט של bump גרסה מפסיל אפוא את **כל** המעטפות.

**עלות מלאה של release ציבורי**: הרצת `package:win` מלאה (לוכדת מחדש `packaged-e2e` + `approval` בשלב exact-artifact) ו־recapture של `shared-state` ו־`thin-installer` (סקריפטים, `RECAPTURE` ב־`subject-registry.mjs`). (קטגוריית `telegram` הידנית הוסרה מהחוזה ב־2026-08-18 — היא הוכיחה מנגנון של המנוע, לא קוד של העטיפה.) זו עלות מובנית ומכוונת — האפיון לא עוקף אותה אלא מתמחר אותה ב־checklist (§5.4) וממליץ **לצרף שינויים ל־releases מרוכזים** במקום bumps תכופים.

---

## 2. מטרות

1. סכמת גרסאות אחת, כבולה לחוזה ה־release הקיים, עם עוגן ציבורי (git tag + GitHub Release) לכל גרסה שהופצה.
2. המשתמש יודע **ביושר** האם תכל'ס שלו מעודכן: בדיקה יזומה + פסיבית מול GitHub Releases API, בתהליך ה־main בלבד.
3. עדכון בפועל בהסכמה מפורשת: הודעה בעברית + פתיחת דף ההורדה בדפדפן; המשתמש מריץ את ה־installer בעצמו (כי הוא לא חתום).
4. סמנטיקת כשלים fail-closed: כשל רשת/פרסינג/מכסה ⇒ "לא ידוע". לעולם לא "אתה מעודכן" ללא הוכחה חיובית.
5. תיקון השקר הקיים ב־`SupportUpdatePanel`.
6. פתיחת הדלת ל־ledger מסוג `github-asset` — מה שמסיר את החסם `version-ledger-unavailable` ממשטח public.

## 3. לא־מטרות

- **אין עדכון אוטומטי שקט** (התקנה/הורדה ללא הסכמה) — לא כל עוד ה־installer לא חתום. ניתוח מלא ב־§10.
- **אין שינוי בזרימת עדכון hermes-agent** — היא נשארת כמות שהיא ומשמשת רק כדפוס.
- **אין טלמטריה** — שום מזהה משתמש, שום דיווח שימוש. בקשת GET אנונימית בלבד.
- **אין שרת שלנו** (Vercel מחוץ לתחום ממילא) — GitHub Releases API הוא הדלת הרשמית היחידה.
- **אין הסרה של `verify-no-update-metadata`** ואין `build.publish` שאינו `null` בשלב זה.
- אין תמיכה בשדרוג delta/blockmap — הורדה מלאה של installer בלבד.

---

## 4. החלטות עיצוב

### D1 — סכמת גרסאות: SemVer 2.0.0 עם תגי קדם־שחרור; ערוץ ה־pipeline נשאר אורתוגונלי

- פורמט: `MAJOR.MINOR.PATCH[-alpha.N | -beta.N]` (הקיים: `0.4.0-alpha.1` כבר תואם).
- `qa`/`public` של `package-win.mjs` הם **ערוצי pipeline** (חתימה, demo transport, חומרת gate) — **לא** חלק מהגרסה, וכך נשארים. artifact של ערוץ qa **לעולם אינו מופץ** (התקדים קיים: `release/qa-thin-installer-DO-NOT-DISTRIBUTE`). רק פלט `--channel public` עולה ל־GitHub Releases.
- מיפוי ל־GitHub: גרסה עם תג קדם־שחרור ⇒ Release מסומן `prerelease: true`; גרסה יציבה ⇒ Release רגיל (`latest`).
- מדיניות התאמת ערוץ בבדיקת עדכון: התקנה יציבה משווה רק מול releases יציבים; התקנת `-alpha/-beta` משווה מול הכול (כדי שמשתמשי אלפא יקבלו גם את האלפא הבאה וגם את היציבה שסוגרת אותה).

### D2 — מקור אמת יחיד: `package.json`; git tag נגזר וכבול

- `git tag -a v<version>` (annotated) על קומיט ה־release, כאשר `v<version>` שווה בדיוק ל־`version` שב־`package.json` באותו קומיט. שם ה־tag ב־GitHub Release (`tag_name`) הוא אותו `v<version>`.
- הכריכה ההפוכה כבר קיימת: ה־`commit_fingerprint` שבתוך ה־release report (`binding.mjs:14-18`) קושר את ה־artifact לקומיט; ה־tag רק נותן לאותו קומיט שם ציבורי יציב. אימות ההתאמה tag↔package.json הוא צעד checklist (§5.4) עם סקריפט עזר קטן (Phase 4) — **לא** שכפול של gate קיים.

### D3 — שם artifact להפצה: ASCII

`expectedInstallerName` (`artifact-set.mjs:14`) מייצר היום שם עברי. GitHub Releases מנרמל שמות assets (תווים לא־ASCII מוחלפים/נמחקים), מה ששובר: (א) כתובת הורדה צפויה, (ב) התאמת שם↔ledger, (ג) הוראות ידניות למשתמש. ההחלטה:

- מוסיפים `build.win.artifactName: "Tachles-Setup-${version}.exe"` (`productName` נשאר `תכל'ס` — קיצור דרך, תיקיית התקנה ושם החלון לא משתנים).
- מעדכנים **בצעד אחד (lockstep)** את `expectedInstallerName` ב־`artifact-set.mjs` ואת בדיקותיו (`artifact-set.test.mjs`), ואת כל מקום שנשען על התבנית הישנה (לאתר עם grep על `Setup`). כלל "בדיוק installer אחד" ופירסור הגרסה מהשם (`checksums.mjs: versionFromInstallerName`) נשמרים — רק התבנית מתחלפת.
- חלופה שנדחתה: להשאיר שם עברי ולקבל את הנרמול של GitHub — נדחתה כי היא שוברת את הצפיות של ה־ledger וה־checklist ומייצרת שם asset שאיש לא שולט בו.

### D4 — מסלול העדכון עכשיו: notify + הורדה ידנית (לא electron-updater)

נימוק מלא ב־§10. תמצית: התקנה אוטומטית של binary לא חתום היא anti-pattern אבטחתי; SmartScreen ממילא הופך אותה לאינטראקטיבית; ו־latest.yml נדחה בכוונה ע"י השלב מ־§1.2.

### D5 — הבדיקה חיה ב־main process; ה־renderer מקבל תוצאה בלבד

ה־renderer לא מדבר עם `api.github.com`. נוסף IPC endpoint אחד בקריאה בלבד (`hermes:companion-update`) — פירוט ב־§6.4, כולל התשובה לשאלת ipc-guards.

### D6 — Changelog דו־לשוני ב־`CHANGELOG.md`

פורמט מבוסס Keep-a-Changelog, לכל גרסה שני תתי־סעיפים: `### מה חדש (למשתמש)` בעברית — הוא זה שמועתק ל־body של ה־GitHub Release ומוצג (מקוצר) באפליקציה; `### Technical (English)` — פירוט הנדסי. זהו קובץ מקור רגיל (לא נכנס ל־artifact, לא subject של אף מעטפה — עריכתו זולה).

### D7 — ה־ledger ניזון מה־release שפורסם

אחרי פרסום ה־Release, ה־sha256 של ה־asset (זהה ל־`SHA256SUMS.txt` שכבר נוצר ב־`finalize-release.mjs`) נרשם ב־`release-ledger.json` עם `source: 'github-asset'` ומקומט. כך הדרישה הקיימת של `prior-ledger.mjs` מסופקת לראשונה באמת, וגרסה שפורסמה הופכת לבלתי־ניתנת־לדריסה.

---

## 5. סכמת הגרסאות והצמתה לחוזה

### 5.1 שרשרת הזהות המלאה (קיים + חדש)

```
package.json "version"                                (מקור אמת — קיים)
   ├─► build attestation: app_version                 (קיים — gen-build-attestation.mjs)
   ├─► artifact name: Tachles-Setup-<version>.exe     (קיים כמנגנון; D3 משנה תבנית)
   ├─► release-manifest בתוך ה־payload                (קיים — after-pack.cjs)
   ├─► release-report: release_binding_digest         (קיים — gen-release-report.mjs)
   ├─► checksums.json / SHA256SUMS.txt                (קיים — finalize-release.mjs)
   ├─► git tag v<version> על קומיט ה־release          (חדש — checklist + סקריפט אימות)
   ├─► GitHub Release: tag_name=v<version>,           (חדש — הפצה)
   │      assets = installer + SHA256SUMS.txt
   └─► release-ledger.json entries[version].sha256    (חדש בפועל — הסכימה קיימת)
```

### 5.2 כללי bump

- `PATCH` — תיקונים בלבד; `MINOR` — יכולת חדשה תואמת; `MAJOR` — שבירת תאימות (כולל שבירת חוזה מול hermes-plugin או פורמט state).
- קדם־שחרור: `-alpha.N` פנימי/מוקדם, `-beta.N` מועמד. הסרת הסיומת = היציבה.
- **גרסה שפורסמה לעולם אינה נבנית מחדש** — `version-reuse` ב־`prior-ledger.mjs` אוכף זאת ברגע שה־ledger מאוכלס. כל שינוי, ולו טריוויאלי ⇒ bump.

### 5.3 GitHub Release — תוכן מחייב

| רכיב | ערך |
|---|---|
| `tag_name` | `v<version>` |
| `name` | `תכל'ס <version>` |
| `body` | הסעיף העברי מה־CHANGELOG + פסקת התקנה קבועה: הקובץ אינו חתום, Windows SmartScreen יציג אזהרה, יש לאמת SHA-256 מול `SHA256SUMS.txt` |
| `prerelease` | `true` אם יש תג קדם־שחרור |
| assets | `Tachles-Setup-<version>.exe`, `SHA256SUMS.txt` |
| draft | מפרסמים רק אחרי שה־pipeline הציבורי עבר promotion — לעולם לא לפני |

### 5.4 Checklist שחרור (העלות המלאה של bump)

1. ריכוז שינויים; עדכון `CHANGELOG.md` (עברית + אנגלית).
2. bump `version` ב־`package.json` — **מרגע זה כל מעטפות הראיות פסולות** (§1.5).
3. recapture זול: `shared-state`, `thin-installer` (פקודות ב־`docs/evidence/README.md:90-96`; ל־public נדרש `thin-installer` = `passed`, qa/pilot רשאים להשאירו חסם כן).
4. `npm run package:win` (public) — 12 השלבים; exact-artifact לוכד `packaged-e2e`+`approval` כבולים ל־build; promotion אחרון. כל כשל ⇒ עצירה, אין artifact.
5. קומיט של המעטפות (מותר — evidence-only לא מפסיל, `README.md:160-163`).
6. `git tag -a v<version> -m "תכל'ס <version>"` על קומיט ה־release; `git push --tags`.
7. יצירת GitHub Release (draft ⇒ publish) עם ה־assets מ־`release/`.
8. עדכון `release-ledger.json` (`github-asset`, sha256 מ־`SHA256SUMS.txt`), קומיט.
9. אימות סגירה: `node scripts/verify-release-contract.mjs --channel public` נקי, ובדיקת עדכון מתוך התקנה קודמת מזהה את הגרסה.

---

## 6. ארכיטקטורת בדיקת העדכון

### 6.1 מודולים חדשים (main process)

```
electron/companion-update-core.cjs    ← טהור: פירסור, השוואת semver, פסק־דין
electron/companion-update-core.test.ts
electron/companion-update.cjs         ← impure: fetch, throttle, cache, חיווט
electron/companion-update.test.ts
```

הפרדת pure/impure זהה לדפוס `hermes-update-flow.cjs` (אורקסטרציה טהורה, collaborators מוזרקים) ו־`ipc-guards.cjs`.

**`companion-update-core.cjs` מכיל:**

- `parseSemver(text)` — מקבל רק `/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/`; אחרת `null` (לעולם לא זריקה, לעולם לא ניחוש).
- `compareSemver(a, b)` — סדר SemVer 2.0.0 מלא כולל קדם־שחרור (יציבה > קדם־שחרור; מזהים מספריים מושווים מספרית). מימוש עצמי קטן ונבדק — **ללא תלות npm חדשה** (בהתאם למשמעת התלויות של הריפו).
- `selectEligibleRelease(releases, currentVersion)` — מסנן drafts; מסנן prereleases אם הנוכחית יציבה; בוחר את הגבוהה ביותר לפי `parseSemver(tag_name)`; entry עם tag בלתי־פרסיבי מדולג ולא מפיל.
- `decideVerdict(current, eligible)` — מחזיר בדיוק אחד מ:

| status | תנאי | חובת הוכחה |
|---|---|---|
| `update-available` | `eligible > current` | fetch תקין + tag פרסיבי |
| `up-to-date` | fetch תקין **וגם** `eligible <= current` | חיובית בלבד |
| `dev-ahead` | `current` גדולה מכל מה שפורסם | fetch תקין |
| `unknown` | כל דבר אחר: timeout, HTTP != 200, rate-limit, JSON פגום, אף tag פרסיבי, רשימה ריקה | — ברירת המחדל |

- `sanitizeReleaseNotes(body)` — טקסט בלבד: קיטום ל־600 תווים, הסרת תווי בקרה. **תוכן ה־release הוא data לא־מהימן**: מוצג כטקסט (לא markdown/HTML), לעולם לא מפורש כהוראות, ואף URL מתוכו אינו נפתח — הקישור היחיד שנפתח הוא `html_url` שעבר אימות prefix (§6.3).

**`companion-update.cjs` מכיל:**

- `checkCompanionUpdate({ force })` — GET אחד:
  - URL: `https://api.github.com/repos/NehoraiHadad/hermes-business/releases?per_page=20` (לא `releases/latest` — הוא מסתיר prereleases וסוגר את ערוץ האלפא).
  - Headers: `Accept: application/vnd.github+json`, `User-Agent: tachles-companion` (חובה מול GitHub; **בלי** גרסה — מזעור זליגת מידע). ללא אימות, ללא עוגיות.
  - Timeout: `AbortSignal.timeout(10_000)`.
  - `current = app.getVersion()` (אותו מקור כמו `runtime.cjs:59`).
  - כל חריגה ⇒ `{ status: 'unknown', message: 'לא ניתן לבדוק עדכונים כרגע' }` — אין זריקה אל ה־renderer ממסלול הבדיקה הפסיבית; הבדיקה היזומה מחזירה את אותו אובייקט (לא reject) כדי שה־UI יציג "לא ידוע" ולא toast שגיאה גנרי.
- Serial guard: `createSerialGuard('בדיקת עדכון כבר מתבצעת')` מ־`ipc-guards.cjs` — אותו idiom של `hermes:install` (`ipc.cjs:50`).
- Cache בזיכרון: `{ verdict, checkedAt }`; קריאה ללא `force` בתוך 6 שעות מחזירה cache. Throttle פסיבי עמיד: `companion-update-state.json` תחת `app.getPath('userData')`, כתיבה אטומית עם `atomic-write.cjs` הקיים.

### 6.2 מבנה ה־verdict (החוזה מול ה־renderer)

```ts
type CompanionUpdateStatus = {
  status: 'update-available' | 'up-to-date' | 'dev-ahead' | 'unknown'
  current: string                    // הגרסה הרצה
  latest?: string                    // רק כשהוכחה
  releaseName?: string               // מקוטע
  notes?: string                     // טקסט מסונן, <=600 תווים
  downloadUrl?: string               // html_url מאומת-prefix בלבד
  publishedAt?: string               // ISO
  checkedAt: number | null           // epoch ms של בדיקה מוצלחת אחרונה
  message?: string                   // עברית, מנוסחת ב-main (דפוס preload.cjs:11-33)
}
```

סקלרים בלבד; שום אובייקט גולמי מתשובת GitHub לא חוצה את גבול ה־IPC.

### 6.3 אימות `downloadUrl`

ב־main, לפני שמאוחסן ב־verdict: חייב להתחיל ב־`https://github.com/NehoraiHadad/hermes-business/releases/` — אחרת מושמט (וה־UI מציג הודעה בלי כפתור). הפתיחה עצמה עוברת דרך הערוץ הקיים `hermes:open-external` (`ipc.cjs:138-140`) שמסונן ממילא ב־`isAllowedExternalUrl` (https בלבד, `url-policy.cjs:9-12`) — הגנה כפולה, אפס מנגנון חדש.

### 6.4 משטח IPC — ההכרעה בשאלת ipc-guards

**כן נדרש endpoint חדש הפונה ל־renderer — אך הוא מינימלי ובטוח בהגדרה:**

- הבדיקה עצמה, הרשת, הפירסור והחלטת ה־verdict — **כולם ב־main בלבד**. ל־renderer אין ולא תהיה גישה ל־`api.github.com`.
- הערוץ החדש `hermes:companion-update` (invoke) מקבל פרמטר renderer יחיד: `force: boolean`, שמנורמל ב־main ל־`Boolean(force)` — אין משטח קלט לסינון מעבר לכך (בניגוד ל־`hermes:api` שדרש allowlist שלם). מחזיר את ה־verdict הסקלרי בלבד.
- אין שימוש חוזר ב־`hermes:api` — הוא allowlist של gateway מקומי עם token (`ipc-guards.cjs`, "hermes:api boundary") ואסור להרחיבו לאינטרנט.
- רישום: `ipc.cjs` בתוך `registerIpc()`; חשיפה: `preload.cjs` — `checkCompanionUpdate: (force) => invoke('hermes:companion-update', force)` (עובר את נירמול השגיאות הקיים); טיפוס: `src/vite-env.d.ts`; פסאדה: `src/lib/hermes/desktop.ts` בדפוס `getVersions` (`desktop.ts:39,100-101`), עם עמית demo ב־`demo-desktop.ts` שמחזיר `unknown` קבוע.

### 6.5 בדיקה פסיבית בהפעלה

- 60 שניות אחרי `ready` (לא לחסום את ה־boot ולא להתחרות ב־startup של Hermes), רק אם `checkedAt` העמיד ישן מ־24 שעות.
- תוצאה `update-available` ⇒ אירוע חד־פעמי ל־renderer (webContents send דרך preload listener) שמדליק badge — לא דיאלוג חוסם.
- **מנוטרלת כשה־QA runtime override פעיל** (`qa-runtime.cjs` sentinel) וכן תחת משתנה סביבה `TACHLES_DISABLE_UPDATE_CHECK=1` — כדי שה־E2E הארוז (isolated) יישאר הרמטי ולעולם לא ייכשל/יאט בגלל זמינות GitHub. הבדיקה היזומה בכפתור אינה מנוטרלת (היא פעולת משתמש).

---

## 7. עיצוב UI (RTL)

### 7.1 SupportUpdatePanel — תיקון ושדרוג

השורה הקיימת (`SupportUpdatePanel.tsx:35-39`) מוחלפת:

- `<strong>{versions.shell}</strong>` — ללא fallback `'0.1.0'` (אם הגשר לא ענה: `'—'`). מספרי גרסה נעטפים `<bdi dir="ltr">` כדי שלא יתהפכו במשפט עברי (המחלקות `version-row`/`version-note` הקיימות ב־`screen-support.css` נשמרות).
- תג הסטטוס מציג לפי ה־verdict: `יש עדכון` / `מעודכן` / `גרסה מקומית חדשה מהפורסם` / `לא ידוע` / `לא נבדק` (ברירת מחדל לפני כל בדיקה — כמו אצל Hermes בשורה 32). **המחרוזת הקבועה `'מעודכן'` נמחקת.**
- כפתור `בדוק עדכון` הקיים מרחיב את `onUpdateCheck` (`useSupportActions.ts:98-113`): בודק Hermes (קיים) **וגם** קומפניון (חדש, hook נפרד `useCompanionUpdate`); שתי התוצאות מוצגות כל אחת בשורתה.
- כאשר `update-available`: בלוק מתחת לשורה — `גרסה <latest> זמינה` + תאריך + notes מקוטעים כטקסט + כפתור ראשי `פתח דף הורדה` (⇒ `openExternal(downloadUrl)`) + הערה קבועה: `ההורדה נפתחת בדפדפן. הקובץ אינו חתום — Windows עשוי להציג אזהרה. מומלץ לאמת SHA-256 מול SHA256SUMS.txt שבדף ההורדה. סגרו את תכל'ס לפני הרצת ההתקנה.`
- כאשר `unknown`: `לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.` (ניסוח קיים, `useSupportActions.ts:109`).

### 7.2 חיווי פסיבי

Toast חד־פעמי ברמת `info` (לא `error`): `גרסה חדשה של תכל'ס זמינה — פרטים במסך תמיכה`, ונקודת חיווי על כניסת מסך התמיכה. פעם אחת לכל גרסת יעד (נרשם ב־state העמיד `dismissedVersion`), לעולם לא מודאל חוסם.

---

## 8. סמנטיקת כשלים — טבלה מחייבת

| מצב | תוצאה | תצוגה |
|---|---|---|
| אין רשת / DNS / timeout 10s | `unknown` | `לא ידוע` + ההודעה מ־7.1 |
| HTTP 403/429 (rate limit) | `unknown` | כנ"ל |
| HTTP 200, JSON לא־תקין / לא מערך | `unknown` | כנ"ל |
| כל ה־tags בלתי־פרסיביים / רשימה ריקה | `unknown` | כנ"ל — רשימה ריקה **אינה** הוכחת עדכניות |
| fetch תקין, `eligible <= current` | `up-to-date` | `מעודכן` |
| fetch תקין, `current` מעל הכול | `dev-ahead` | `גרסה מקומית חדשה מהפורסם` |
| fetch תקין, `eligible > current`, `html_url` נכשל באימות prefix | `update-available` בלי `downloadUrl` | ההודעה ללא כפתור, עם הפניה ידנית לדף ה־Releases |
| בדיקה במקביל לבדיקה רצה | דחייה ע"י serial guard | `בדיקת עדכון כבר מתבצעת` |
| cache בתוקף וללא `force` | ה־verdict השמור | כרגיל + עדכניות הבדיקה |

עקרון על: **`up-to-date` נטען רק על סמך תשובה חיובית מלאה. כל עמימות ⇒ `unknown`.** (מקביל ל־`interpretHealthResponse` — `useSupportActions.ts:34-37`.)

---

## 9. פרטיות וקצב בדיקה

- **יעד יחיד**: `api.github.com` (ופתיחת דפדפן ל־`github.com` בלחיצת משתמש). שום דומיין אחר.
- **תדירות**: פסיבית — לכל היותר אחת ל־24 שעות (throttle עמיד); יזומה — ללא הגבלה מעשית (cache 6 שעות אלא אם `force`; ה־force של הכפתור כפוף ל־serial guard). תקרת GitHub האנונימית (60/שעה/IP) רחוקה מסדרי הגודל האלה.
- **מה נחשף**: כתובת IP ו־User-Agent גנרי (`tachles-companion`, בלי גרסה) — כמקובל בכל גישת HTTPS. אין מזהה התקנה, אין גרסה נשלחת, אין query parameters, אין cookies.
- **Offline-first**: כשל שקט; שום פונקציונליות של האפליקציה אינה תלויה בבדיקה.
- מסמכים: פסקת "מה נשלח ולאן" נוספת ל־README/מסך התמיכה (שקיפות).

---

## 10. ניתוח electron-updater — ומסלול השדרוג כשתגיע חתימה

### 10.1 למה לא עכשיו (ניתוח כן)

| היבט | מצב עם installer לא חתום |
|---|---|
| אימות ההורדה | electron-updater ב־Windows נשען על התאמת חתימת ה־exe המורד למו"ל המותקן; בלי חתימה אין שרשרת אמון — נשארים עם TLS של GitHub בלבד, וכל פשרה בנתיב מובילה **להרצה אוטומטית** של binary שרירותי. זה ההבדל המהותי מ"הורדה ידנית": שם המשתמש רואה, מאמת checksum ומחליט |
| SmartScreen | exe לא חתום וללא מוניטין מציג אזהרה גם כשה־updater מריץ אותו — "עדכון שקט" הופך לדיאלוג מפחיד שמופיע מעצמו, חוויה גרועה מהודעה יזומה |
| latest.yml | חובה ל־electron-updater; `verify-no-update-metadata.mjs` **מפיל את ה־build** עליו בכוונה (§1.2), ו־`build.publish: null` נקבע במפורש (`ACCEPTANCE.md:139-144`) |
| חוזה ה־release | הוספת feed מוסיפה artifacts (yml, blockmap) שכל שרשרת ה־binding, `artifact-set` ("בדיוק installer אחד") וה־checksums חייבים ללמוד להכיר — שינוי חוזה רחב |
| שם עברי | תבנית ה־URL של latest.yml נשברת על שמות לא־ASCII (D3 מתקן זאת ממילא, אך זו עוד תלות) |

**מסקנה: notify + הורדה ידנית הוא המסלול הנכון עכשיו** — הוא גם מה ש־`ACCEPTANCE.md:143-144` מנחה: "If companion self-update is added later, wire a real electron-updater feed and re-enable publish **deliberately**".

### 10.2 מסלול השדרוג (Phase 5 — מותנה בתעודת חתימה)

1. תעודה + `build/sign-allowlist.json` מאוכלס (הדרישה כבר קיימת ב־gate: `unsigned-public` וכו', `release-contract.md:95`).
2. שינוי חוזה מכוון בקומיט ייעודי: `build.publish: {provider: 'github'}`; **היפוך** `verify-no-update-metadata` ל־`verify-update-metadata` (נוכחות + עקביות latest.yml מול ה־installer וה־sha512 שלו — הופכים את ה־backstop, לא מוחקים אותו); עדכון `artifact-set`/checksums להכרת ה־sidecars; עדכון `ACCEPTANCE.md` §Update responsibility.
3. הוספת `electron-updater` עם `autoDownload: false` — ה־UX ההסכמתי מ־§7 נשאר; רק כפתור "פתח דף הורדה" מוחלף ב"הורד והתקן" עם אימות חתימה מובנה.
4. כל ה־verdict machinery מ־§6 נשאר — רק ה־action משתדרג. זו הסיבה לבנות עכשיו את הבדיקה כמודול עצמאי ולא כתלות ב־updater.

---

## 11. תוכנית בדיקות

**יחידה (vitest, דפוס `electron/*.test.ts` הקיים):**
- `companion-update-core.test.ts`: כל שורת §8 כ־case; סדר semver מלא (כולל `0.4.0 > 0.4.0-alpha.9`, `alpha.2 < alpha.10` מספרית); סינון prerelease ליציבה; tags פגומים מדולגים; `sanitizeReleaseNotes` (קיטום, תווי בקרה, אי־פירוש markdown); אימות prefix של `downloadUrl` (כולל `https://github.com.evil.tld/...` ⇒ נדחה).
- `companion-update.test.ts` עם fetch מוזרק (דפוס ה־deps של `hermes-update-flow.test.ts`): timeout ⇒ unknown; 403 ⇒ unknown; serial guard; throttle/cache; כתיבת state אטומית.
- `preload.test.ts`: הרחבה — הערוץ החדש קיים ומנרמל שגיאות (דפוס שורות 123-124, 165).
- `constants-lockstep` / `packaging-config.test.ts`: ה־plan של `packagingStages` לא השתנה (הפיצ'ר לא נוגע ב־pipeline).
- lockstep של D3: עדכון `artifact-set.test.mjs` לתבנית החדשה + בדיקה שהתבנית הישנה נדחית.

**אינטגרציה/E2E:**
- `e2e-installed-ui.mjs` (מורחב): במסך תמיכה, בסביבה מבודדת ללא GitHub — השורה מציגה `לא נבדק`, ולחיצה על בדיקה מציגה `לא ידוע` (לעולם לא `מעודכן`). זו הדגמת fail-closed חיה.
- אימות שהבדיקה הפסיבית לא רצה תחת qa sentinel (אין תעבורת רשת יוצאת ל־api.github.com בהרצה מבודדת).
- בדיקת עשן ידנית לפני release ראשון: התקנת גרסה N-1, פרסום N, אימות שהבדיקה מזהה, שהקישור נפתח, שה־SHA תואם.

**חוזה:** `verify-no-update-metadata` נשאר ירוק (הפיצ'ר לא מייצר yml); `verify-release-contract --channel public` — אחרי Phase 4 הכשל `version-ledger-unavailable` נעלם.

---

## 12. סיכונים

| # | סיכון | חומרה | טיפול |
|---|---|---|---|
| R1 | משתמשים מריצים installer מזויף מקישור זר | גבוהה | קישור יחיד מאומת־prefix; הוראת אימות SHA-256 בכל דף release ובאפליקציה; לטווח ארוך — חתימה (Phase 5) |
| R2 | GitHub מנרמל שם asset עברי | בינונית | D3 (שם ASCII); בדיקת עשן לפני ה־release הראשון |
| R3 | Prompt-injection דרך release notes | בינונית | notes = טקסט מקוטע בלבד; אין markdown; אין פתיחת URL מהתוכן; ה־notes לעולם אינם קלט לשום לוגיקה |
| R4 | עלות recapture הופכת releases לנדירים ובומים גדולים | בינונית | מתומחר ב־checklist; ריכוז שינויים; qa רשאי חסם כן (thin-installer) |
| R5 | rate-limit של GitHub בהתקנות מאחורי NAT משותף | נמוכה | throttle 24h + cache; כשל ⇒ unknown, לא שגיאה |
| R6 | בלבול משתמש בין גרסת Hermes לגרסת תכל'ס | נמוכה | הפרדה ויזואלית בפאנל + ניסוח "תכל'ס (האפליקציה)" מול "Hermes Agent" |
| R7 | ה־E2E הארוז נהיה תלוי־רשת | בינונית | נטרול הבדיקה הפסיבית תחת qa sentinel + env flag (§6.5) |
| R8 | שינוי `artifactName` שובר כריכה קיימת בשקט | גבוהה | D3 מבוצע בקומיט lockstep יחיד עם עדכון `artifact-set.mjs` + בדיקותיו; ה־gate עצמו יתפוס אי־התאמה (`unexpected installer name`) |

---

## 13. שלבי ביצוע (כל שלב = משימה סגורה בגודל Sonnet)

### שלב 1 — זהות הפצה: שם artifact ASCII (D3)
עבודה: `build.win.artifactName` ב־`package.json`; עדכון `expectedInstallerName` ב־`scripts/lib/release/artifact-set.mjs` + `artifact-set.test.mjs`; grep לתבנית `Setup` ועדכון כל תלות (סקריפטים/מסמכים).
קבלה: `npm run test:unit` ירוק; `node scripts/package-win.mjs --channel qa --dry-run` ללא שינוי plan; הרצת `package:win:qa` מלאה מפיקה `Tachles-Setup-<version>.exe` יחיד וה־gate עובר (לאחר recapture); שום מופע של התבנית הישנה בקוד חי.

### שלב 2 — מנוע הבדיקה ב־main
עבודה: `electron/companion-update-core.cjs` + `companion-update.cjs` + שתי חבילות בדיקות (§6.1, §11); state עמיד עם `atomic-write.cjs`; נטרול פסיבי תחת qa sentinel/env.
קבלה: כל שורות טבלת §8 מכוסות בבדיקה עוברת; אף `throw` לא חוצה אל ה־renderer ממסלול הבדיקה; אין תלות npm חדשה; `unknown` הוא ברירת המחדל לכל ענף שלא הוכח.

### שלב 3 — חיווט IPC + פסאדה
עבודה: `hermes:companion-update` ב־`ipc.cjs` (עם serial guard ונירמול `force`); `preload.cjs` + `preload.test.ts`; `vite-env.d.ts`; `desktop.ts`/`demo-desktop.ts`; אירוע הבדיקה הפסיבית.
קבלה: `preload.test.ts` מאמת ערוץ + נירמול שגיאות; ה־renderer מקבל סקלרים בלבד (בדיקת shape); demo מחזיר `unknown`.

### שלב 4 — UI במסך תמיכה
עבודה: hook `useCompanionUpdate`; החלפת השורה הקבועה ב־`SupportUpdatePanel.tsx` (מחיקת `'מעודכן'` הקבוע ו־fallback `'0.1.0'`); בלוק update-available עם `openExternal`; `<bdi dir="ltr">` לגרסאות; toast פסיבי + dismissedVersion.
קבלה: חמשת מצבי התצוגה מ־§7.1 מיושמים; מצב offline מציג `לא ידוע`; אין דיאלוג חוסם; `npm run build` ירוק; הרחבת `e2e-installed-ui` עוברת.

### שלב 5 — תהליך השחרור הראשון + ledger
עבודה: `CHANGELOG.md` (D6); `docs/RELEASING.md` עם checklist §5.4; סקריפט עזר `scripts/verify-version-tag.mjs` (tag ↔ package.json, read-only); ביצוע release ציבורי ראשון מלא: tag, GitHub Release, אכלוס `release-ledger.json` (`github-asset`), קומיט.
קבלה: `verify-release-contract --channel public` ללא `version-ledger-unavailable`; התקנה של הגרסה הקודמת מזהה את החדשה (בדיקת עשן R2); ה־checklist שוחזר מהמסמך בלבד ללא ידע שבטי.

### שלב 6 (עתידי, לא מתוזמן — מותנה חתימה) — electron-updater
לפי §10.2; נפתח רק עם תעודה ו־allowlist, כשינוי חוזה מתועד.

---

## נספח: קבצים מרכזיים

- `scripts/lib/release/artifact-set.mjs` — תבנית שם ה־installer שחייבת להתעדכן lockstep עם `artifactName` (שלב 1)
- `electron/ipc.cjs` — רישום הערוץ `hermes:companion-update` ודפוס ה־serial guard (שלב 3)
- `electron/preload.cjs` — חשיפת הגשר לצד ה־renderer עם נירמול השגיאות הקיים (שלב 3)
- `src/components/screens/support/SupportUpdatePanel.tsx` — מקום התיקון של טענת ה"מעודכן" הקבועה וה־UI החדש (שלב 4)
- `scripts/verify-no-update-metadata.mjs` — הגבול שהאפיון מכבד היום והופך בכוונה רק בשלב 6
