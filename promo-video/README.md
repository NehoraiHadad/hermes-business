# סרטון התדמית — העוזר לעסק

סרטון מוצר מונפש בעברית שנבנה ב־Remotion עבור ה־POC של המעטפת העסקית מעל Hermes.
כל הדוגמאות בדיוניות ואינן כוללות מספרי טלפון, Tokens, פרטי לקוחות או תוכן משתמש אמיתי.

## תוכן הסרטון

- אשף היכרות עם המשתמש והעסק.
- צ׳אט זמין עם Streaming ופעילות הסוכן בשפה פשוטה.
- אישור ברור לפני פעולות משמעותיות.
- חיבור Google Workspace, Telegram ו־WhatsApp.
- מדיניות WhatsApp לקריאה בלבד או למענה לשיחות נבחרות.
- Skills ומשימות מתוזמנות שמנוהלים על ידי Hermes.
- Health Check, חבילת אבחון וגישה לממשק Hermes המלא.
- התקנת Hermes אחת ו־State משותף לשני הממשקים.

## הרצה

```powershell
cd promo-video
npm install
npm run render
npm run validate
```

הפקודה `npm run render` מייצרת פסקול מקורי וקוד־מופק, ואז מרנדרת H.264 עם אודיו AAC.

## תוצר

```text
promo-video/out/hermes-business-promo.mp4
```

מפרט היעד: `1920x1080`, ‏`30fps`, משך `55` שניות, H.264/AAC.

ה־render הסופי נבדק ב־`ffprobe`:

- משך: `55.061333` שניות.
- רזולוציה: `1920x1080` ב־`30fps`.
- קידוד: H.264 + AAC stereo.
- גודל: `8,893,157` bytes.
- SHA-256: `CE22DC82F6A4714A951B1492E16CAB6A657622152DF1FE4C964CF2CC449AEBC2`.
- עוצמת הפסקול: ממוצע `-29.5 dB`, שיא `-18.0 dB`.
- Remotion `4.0.503`; ‏`npm audit` החזיר `0 vulnerabilities`.

לפתיחת סביבת העריכה:

```powershell
npm run soundtrack
npm run studio
```
