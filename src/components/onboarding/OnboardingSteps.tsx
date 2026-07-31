import { CheckCircle2, ChevronLeft, Cloud, LoaderCircle, Plus, ShieldCheck, Sparkles } from 'lucide-react'
import type { OnboardingData } from '../../types'
import { Logo } from '../ui/Logo'
import { ServiceIcon } from '../ui/ServiceIcon'
import { BusinessStep, ProfileStep } from './OnboardingFormSteps'

// Wizard step router: the lighter welcome / AI-provider / services screens live
// here inline, while the two text-form screens live in ./OnboardingFormSteps so no
// single onboarding file grows large.
export function OnboardingStep({
  step,
  data,
  patch,
  runtime,
  onProvider
}: {
  step: number
  data: OnboardingData
  patch: (values: Partial<OnboardingData>) => void
  runtime: HermesRuntime | null
  onProvider: () => void
}) {
  if (step === 1) {
    return (
      <div className="onboarding__content onboarding__welcome">
        <div className="onboarding-hero">
          <Logo />
          <span className="onboarding-hero__spark">✦</span>
        </div>
        <h1>העסק שלך, עם Hermes מוכן לעבודה</h1>
        <p>נכיר אותך ואת העסק, נחבר את הכלים החשובים, ותוכל להתחיל בלי Terminal או קבצי הגדרות.</p>
        <div className="runtime-detection">
          {runtime?.installed ? <CheckCircle2 size={20} /> : <LoaderCircle className="spin" size={20} />}
          <div>
            <strong>{runtime?.installed ? 'Hermes זוהה במחשב' : 'בודק אם Hermes מותקן…'}</strong>
            <small>{runtime?.version || 'אותו Profile ישמש גם בממשק המלא'}</small>
          </div>
        </div>
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="onboarding__content">
        <span className="eyebrow">חיבור AI</span>
        <h1>מי יפעיל את העוזר?</h1>
        <p>Hermes תומך בכמה ספקים. אפשר להחליף גם בהמשך בלי לאבד שיחות או זיכרון.</p>
        <button className="provider-choice" onClick={onProvider}>
          <span className="provider-choice__icon">
            <Cloud size={21} />
          </span>
          <span>
            <strong>חבר ספק AI</strong>
            <small>OpenRouter, Anthropic, OpenAI או Gemini</small>
          </span>
          <ChevronLeft size={18} />
        </button>
        <div className="info-inline">
          <ShieldCheck size={17} />
          <span>המפתח נשמר ישירות ב־Hermes במחשב שלך.</span>
        </div>
      </div>
    )
  }

  if (step === 3) return <ProfileStep data={data} patch={patch} />

  if (step === 4) return <BusinessStep data={data} patch={patch} />

  return (
    <div className="onboarding__content">
      <span className="eyebrow">כמעט סיימנו</span>
      <h1>איפה העסק עובד היום?</h1>
      <p>אפשר לדלג ולחבר שירותים אחר כך.</p>
      <div className="onboarding-services">
        <button>
          <ServiceIcon type="google" />
          <span>
            <strong>Google Workspace</strong>
            <small>מייל, יומן ומסמכים</small>
          </span>
          <Plus size={17} />
        </button>
        <button>
          <ServiceIcon type="telegram" />
          <span>
            <strong>Telegram</strong>
            <small>העוזר גם בטלפון</small>
          </span>
          <Plus size={17} />
        </button>
      </div>
      <div className="onboarding-ready">
        <Sparkles size={19} />
        <span>
          המידע יישמר ב־<strong>USER.md</strong> וב־<strong>business-context Skill</strong> של אותו Profile.
        </span>
      </div>
    </div>
  )
}
