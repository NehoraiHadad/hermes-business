import { ArrowLeft, CheckCircle2, Cloud, Download, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { EMPTY_ONBOARDING } from '../../constants'
import type { ProviderStatus } from '../../lib/provider-readiness'
import type { OnboardingData } from '../../types'
import { Logo } from '../ui/Logo'

export function Onboarding({
  runtime,
  providerStatus,
  installing,
  installError,
  onInstall,
  onComplete,
  onProvider
}: {
  runtime: HermesRuntime | null
  providerStatus: ProviderStatus
  installing: boolean
  installError: string
  onInstall: () => Promise<unknown>
  onComplete: (data: OnboardingData) => Promise<void>
  onProvider: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [completeError, setCompleteError] = useState('')
  const runtimeReady = Boolean(runtime?.running)
  const providerReady = providerStatus.provider_ready

  const start = async () => {
    setCompleteError('')
    if (!runtimeReady) {
      try {
        await onInstall()
      } catch {
        return
      }
      return
    }
    if (!providerReady) {
      onProvider()
      return
    }
    setSaving(true)
    try {
      await onComplete({ ...EMPTY_ONBOARDING, approvals: [...EMPTY_ONBOARDING.approvals] })
    } catch (caught) {
      setCompleteError(
        caught instanceof Error
          ? caught.message
          : 'לא ניתן היה להתחיל את השיחה. אפשר לנסות שוב.'
      )
    } finally {
      setSaving(false)
    }
  }

  const actionLabel = installing
    ? 'מתקין ומפעיל…'
    : saving
      ? 'פותח שיחה…'
      : runtime === null
        ? 'בודק את Hermes…'
        : !runtimeReady
          ? runtime.error
            ? 'נסה להפעיל שוב'
            : 'התקן והמשך'
          : !providerReady
            ? 'חבר את ChatGPT והמשך'
            : 'התחל שיחה עם העוזר'

  return (
    <div className="onboarding onboarding--conversation-first">
      <section className="onboarding__card onboarding__card--simple">
        <div className="onboarding__brand">
          <Logo />
          <strong>העוזר לעסק</strong>
        </div>

        <div className="onboarding__content onboarding__welcome onboarding__welcome--simple">
          <div className="onboarding-hero">
            <Logo />
            <span className="onboarding-hero__spark">✦</span>
          </div>
          <span className="eyebrow">פשוט מתחילים לדבר</span>
          <h1>נכיר תוך כדי עבודה</h1>
          <p>
            בלי שאלון ובלי טפסים. בשיחה הראשונה העוזר ילמד מה העסק עושה,
            יכין סיכום לאישור ויעזור כבר במשימה הראשונה.
          </p>

          <div className="setup-readiness" aria-label="מצב ההכנה">
            <div className={runtimeReady ? 'setup-readiness__item setup-readiness__item--ready' : 'setup-readiness__item'}>
              {runtimeReady ? <CheckCircle2 size={19} /> : <Download size={19} />}
              <span>
                <strong>המנוע העסקי</strong>
                <small>{runtimeReady ? 'מוכן לעבודה' : runtime === null ? 'נבדק כעת' : 'יוגדר אוטומטית'}</small>
              </span>
            </div>
            <div className={providerReady ? 'setup-readiness__item setup-readiness__item--ready' : 'setup-readiness__item'}>
              {providerReady ? <CheckCircle2 size={19} /> : <Cloud size={19} />}
              <span>
                <strong>חיבור ל־AI</strong>
                <small>{providerReady ? `${providerStatus.provider_label} מחובר` : 'נחבר פעם אחת באופן מאובטח'}</small>
              </span>
            </div>
          </div>

          <div className="conversation-first-note">
            <MessageCircle size={18} />
            <span>חיבורים ליומן, למייל או להודעות יוצעו רק כשהם יעזרו במשימה שביקשת.</span>
          </div>
          <div className="info-inline onboarding-safety-note">
            <ShieldCheck size={17} />
            <span>העוזר יבקש אישור לפני שמירת הידע ולפני פעולות חיצוניות משמעותיות.</span>
          </div>
        </div>

        <div className="onboarding__footer onboarding__footer--simple">
          <span>אפשר להשלים או לשנות הכול אחר כך בשיחה.</span>
          <button
            className="primary-button"
            disabled={installing || saving || runtime === null}
            onClick={() => void start()}
          >
            {installing || saving || runtime === null ? <LoaderCircle className="spin" size={16} /> : null}
            {actionLabel}
            {!installing && !saving && runtimeReady && providerReady ? <ArrowLeft size={16} /> : null}
          </button>
        </div>
        {installError || completeError ? (
          <p className="form-error onboarding__error">{completeError || installError}</p>
        ) : null}
      </section>
    </div>
  )
}
