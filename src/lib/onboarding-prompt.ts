import type { OnboardingData } from '../types'

// The shell performs a bounded inspection through official Hermes APIs and hands
// the agent a verified snapshot so onboarding never re-runs those checks.
export function buildOnboardingPrompt(
  data: OnboardingData,
  verifiedSnapshot: Record<string, unknown>
): string {
  return [
    '/business-bootstrap',
    'המשך את הקמת העוזר לעסק.',
    'המעטפת ביצעה בדיקה תחומה דרך ה־APIs הרשמיים של Hermes. השתמש ב־snapshot הבא ואל תחזור על הבדיקות לפני השאלה הבאה.',
    'המשתמש מילא את פרטי ההיכרות הבאים במעטפת. שמור עובדות יציבות באמצעות מנגנוני Hermes המתאימים ועדכן את business-context Skill; אל תיצור System Prompt גדול.',
    'אל תבקש שוב מידע שכבר נמסר. לאחר השמירה, שאל רק את השאלה החסרה הבאה או המלץ על חיבור אחד בעל הערך המיידי הגבוה ביותר.',
    'אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.',
    '',
    `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(verifiedSnapshot)}`,
    '',
    JSON.stringify(data, null, 2)
  ].join('\n')
}
