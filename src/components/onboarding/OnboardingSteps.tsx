import { CheckCircle2, ChevronLeft, Cloud, Download, LoaderCircle, Plus, ShieldCheck, Sparkles } from 'lucide-react'
import type { Connection, OnboardingData } from '../../types'
import { Logo } from '../ui/Logo'
import { ServiceIcon } from '../ui/ServiceIcon'
import { BusinessStep, ProfileStep } from './OnboardingFormSteps'

type Props = {
  step: number
  data: OnboardingData
  patch: (values: Partial<OnboardingData>) => void
  runtime: HermesRuntime | null
  connections: Connection[]
  installError: string
  onProvider: () => void
  onConnection: (id: string) => void
}

export function OnboardingStep(props: Props) {
  const { step, data, patch, runtime, connections, installError, onProvider, onConnection } = props
  const shortVersion = runtime?.version?.match(/\d+\.\d+\.\d+/)?.[0]
  if (step === 1) {
    return (
      <div className="onboarding__content onboarding__welcome">
        <div className="onboarding-hero">
          <Logo />
          <span className="onboarding-hero__spark">✦</span>
        </div>
        <h1>העסק שלך, עם Hermes מוכן לעבודה</h1>
        <p>נכיר אותך ואת העסק, נחבר את הכלים החשובים, ותוכל להתחיל בלי Terminal או קובצי הגדרות.</p>
        <div className={`runtime-detection ${installError ? 'runtime-detection--error' : ''}`}>
          {runtime === null ? (
            <LoaderCircle className="spin" size={20} />
          ) : runtime.running ? (
            <CheckCircle2 size={20} />
          ) : (
            <Download size={20} />
          )}
          <div>
            <strong>
              {runtime === null
                ? 'בודק אם Hermes מותקן…'
                : runtime.running
                ? 'Hermes זוהה ופועל במחשב'
                : runtime.installed
                  ? 'Hermes מותקן וצריך הפעלה'
                  : 'Hermes עדיין אינו מותקן'}
            </strong>
            <small>
              {installError ||
                (runtime === null
                  ? 'בהפעלה הראשונה הבדיקה עשויה להימשך כמה שניות'
                  : shortVersion
                    ? `גרסת Hermes ${shortVersion}`
                    : 'ההתקנה תוריד את הגרסה התואמת ותשמור Profile אחד משותף')}
            </small>
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
          <span className="provider-choice__icon"><Cloud size={21} /></span>
          <span>
            <strong>חבר ספק AI</strong>
            <small>ChatGPT, OpenRouter, Anthropic, OpenAI API או Gemini</small>
          </span>
          <ChevronLeft size={18} />
        </button>
        <div className="info-inline">
          <ShieldCheck size={17} />
          <span>פרטי החיבור נשמרים ישירות ב־Hermes במחשב שלך.</span>
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
        {([
          { id: 'google', title: 'Google Workspace', detail: 'מייל, יומן ומסמכים' },
          { id: 'telegram', title: 'Telegram', detail: 'העוזר גם בטלפון' }
        ] satisfies Array<{ id: Connection['icon']; title: string; detail: string }>).map(service => {
          const connected = connections.find(item => item.id === service.id)?.state === 'connected'
          return (
            <button key={service.id} onClick={() => onConnection(service.id)}>
              <ServiceIcon type={service.id} />
              <span><strong>{service.title}</strong><small>{connected ? 'מחובר ל־Hermes' : service.detail}</small></span>
              {connected ? <CheckCircle2 size={17} /> : <Plus size={17} />}
            </button>
          )
        })}
      </div>
      <div className="onboarding-ready">
        <Sparkles size={19} />
        <span>העוזר יקבל את הפרטים דרך Skill ההקמה וישמור אותם במנגנוני ה־Profile והזיכרון של Hermes.</span>
      </div>
    </div>
  )
}
