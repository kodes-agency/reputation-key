export const AI_SETTLEMENT_TIMEOUT_MILLIS = 5_000 as const

export function createAiSettlementSignal(
  remainingOuterMillis: number = AI_SETTLEMENT_TIMEOUT_MILLIS,
): Readonly<{
  signal: AbortSignal
  dispose(): void
}> {
  if (!Number.isFinite(remainingOuterMillis) || remainingOuterMillis < 0) {
    throw new TypeError('AI settlement remaining deadline is invalid')
  }
  const controller = new AbortController()
  const timeoutMillis = Math.min(
    AI_SETTLEMENT_TIMEOUT_MILLIS,
    Math.max(0, Math.floor(remainingOuterMillis)),
  )
  if (timeoutMillis === 0) {
    controller.abort('settlement_deadline')
    return Object.freeze({ signal: controller.signal, dispose: () => undefined })
  }
  const timer = setTimeout(() => controller.abort('settlement_deadline'), timeoutMillis)
  return Object.freeze({
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  })
}
