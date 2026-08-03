import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Turns a caught render error into a single display string for the
 * fallback UI's <details> panel (message + stack when available). Exported
 * standalone so the formatting logic can be unit tested without mounting
 * any component — this repo has no render/DOM test infra (no jsdom, no
 * @testing-library), so ErrorBoundary itself is not directly unit tested.
 */
export function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || 'שגיאה ללא הודעה'
    return error.stack ? `${message}\n\n${error.stack}` : message
  }
  if (typeof error === 'string') {
    return error.trim() ? error : 'שגיאה לא ידועה'
  }
  if (error == null) {
    return 'שגיאה לא ידועה'
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

type ErrorBoundaryState = {
  hasError: boolean
  error: unknown
}

/**
 * Last-resort render-crash guard for the whole app tree.
 *
 * main.tsx used to render <App/> bare: any error thrown while rendering
 * anywhere in the tree unmounted React entirely and left a blank window,
 * with no fallback path and no devtools for a packaged desktop build. This
 * wraps <App/> so a crash lands on an explanatory Hebrew screen instead of a
 * blank one, and logs the real error to the console for anyone who does have
 * devtools open (or is scraping packaged logs).
 *
 * React only supports catching render errors via a class component today —
 * componentDidCatch/getDerivedStateFromError have no hook equivalent.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ErrorBoundary] תכל'ס נתקלה בשגיאה בזמן רינדור:", error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100%',
          padding: 32,
          textAlign: 'center',
          background: 'var(--bg, #f7f6f1)',
          color: 'var(--ink, #292722)'
        }}
      >
        <strong style={{ fontSize: 18 }}>משהו השתבש</strong>
        <p style={{ margin: 0, color: 'var(--muted, #79756c)', maxWidth: 420 }}>
          האפליקציה נתקלה בשגיאה בלתי צפויה ולא הצליחה להמשיך. נסו להפעיל אותה
          מחדש; אם זה חוזר, פנו לתמיכה עם הפרטים שמופיעים למטה.
        </p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          רענון האפליקציה
        </button>
        <details style={{ marginTop: 8, maxWidth: 480, width: '100%' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted, #79756c)' }}>
            פרטי השגיאה (לצורך פנייה לתמיכה)
          </summary>
          <pre
            style={{
              marginTop: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              textAlign: 'left',
              direction: 'ltr',
              background: 'var(--surface-soft, #f1efe8)',
              border: '1px solid var(--line, #e6e2d8)',
              borderRadius: 8,
              padding: 12
            }}
          >
            {formatErrorDetails(this.state.error)}
          </pre>
        </details>
      </div>
    )
  }
}
