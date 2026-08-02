import logoUrl from '../../assets/tahlas-logo.png'

// The full dimensional identity used in product brand lockups. Chat messages use
// the related, deliberately simpler AssistantMark so they remain clear at 25px.
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'logo--small' : ''}`} aria-hidden="true">
      <img src={logoUrl} alt="" />
    </div>
  )
}
