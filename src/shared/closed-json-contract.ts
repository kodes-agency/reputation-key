export const CLOSED_JSON_MAX_DEPTH = 64 as const
export const CLOSED_JSON_MAX_NODES = 10_000 as const

type ClosedJsonAuditState = {
  readonly seen: Set<object>
  nodes: number
}

export function assertClosedJsonAndFreeze(
  value: unknown,
  errorPrefix: string,
  state: ClosedJsonAuditState = { seen: new Set<object>(), nodes: 0 },
  depth = 0,
): void {
  state.nodes += 1
  if (depth > CLOSED_JSON_MAX_DEPTH || state.nodes > CLOSED_JSON_MAX_NODES) {
    throw new TypeError(`${errorPrefix} exceeds structural bounds`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(`${errorPrefix} contains an invalid number`)
    }
    return
  }
  if (typeof value !== 'object' || state.seen.has(value)) {
    throw new TypeError(`${errorPrefix} is not closed plain JSON`)
  }

  const array = Array.isArray(value)
  if (
    (array && Object.getPrototypeOf(value) !== Array.prototype) ||
    (!array && Object.getPrototypeOf(value) !== Object.prototype)
  ) {
    throw new TypeError(`${errorPrefix} has a non-plain prototype`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${errorPrefix} contains a symbol key`)
  }
  if (array) {
    const ownNames = Object.getOwnPropertyNames(value)
    if (
      ownNames.length !== value.length + 1 ||
      !ownNames.includes('length') ||
      Array.from({ length: value.length }, (_, index) => String(index)).some(
        (index) => !Object.prototype.hasOwnProperty.call(value, index),
      )
    ) {
      throw new TypeError(`${errorPrefix} contains a sparse or extended array`)
    }
  }

  state.seen.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue
    if (
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.get ||
      descriptor.set
    ) {
      throw new TypeError(`${errorPrefix} has an unsafe property: ${key}`)
    }
    if (
      descriptor.value === undefined ||
      typeof descriptor.value === 'bigint' ||
      typeof descriptor.value === 'symbol' ||
      typeof descriptor.value === 'function'
    ) {
      throw new TypeError(`${errorPrefix} has an unsupported property: ${key}`)
    }
    assertClosedJsonAndFreeze(descriptor.value, errorPrefix, state, depth + 1)
  }
  Object.freeze(value)
}
