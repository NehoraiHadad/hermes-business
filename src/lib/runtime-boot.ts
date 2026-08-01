const BOOT_TIMEOUT_MS = 65_000

export function failedRuntime(error: unknown): HermesRuntime {
  return {
    installed: false,
    running: false,
    starting: false,
    mode: 'error',
    version: null,
    error: error instanceof Error ? error.message : String(error || 'Hermes לא הופעל'),
    wsUrl: ''
  }
}

export async function settleRuntimeBoot(
  boot: () => Promise<HermesRuntime>,
  timeoutMs = BOOT_TIMEOUT_MS
): Promise<HermesRuntime> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      boot(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Hermes לא סיים לעלות בזמן. אפשר לנסות שוב או לפתוח את מסך התמיכה.')),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    return failedRuntime(error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
