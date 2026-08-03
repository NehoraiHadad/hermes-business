export const QA_SENTINEL = 'isolated-temp-home'

export function assertSafeInstalledE2E(env = process.env) {
  const isolated = env.HERMES_BUSINESS_QA_RUNTIME === QA_SENTINEL
  const disposable = env.HERMES_BUSINESS_DISPOSABLE_WINDOWS === '1'
  if (!isolated && !disposable) {
    throw new Error(
      'Installed-app E2E is blocked on a normal workstation. Use the isolated app suite, ' +
      'or set HERMES_BUSINESS_DISPOSABLE_WINDOWS=1 only inside a disposable Windows VM.'
    )
  }
}
