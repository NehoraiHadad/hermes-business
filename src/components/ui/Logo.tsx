// The wordmark's abstract brand glyph, used for the app brand lockups
// (sidebar, onboarding, advanced-tools menu). The compact assistant chat avatar
// uses AssistantMark instead so it stays legible at small sizes.
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'logo--small' : ''}`} aria-hidden="true">
      <span className="logo__wing logo__wing--a" />
      <span className="logo__wing logo__wing--b" />
      <span className="logo__core" />
    </div>
  )
}
