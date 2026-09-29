// In-memory stand-in for the Redis the Google quota and in-flight coordinators
// share (`GoogleCoordinationRedis`).
//
// It executes the same three Lua scripts by their version tag, with the same
// token-bucket and lease arithmetic, so a test can drive the real coordinators
// (and anything built on them, such as the admission service) without a Redis
// server. Any other script is refused, so a new script cannot silently pass.

import type { GoogleCoordinationRedis } from '#/shared/google-provider-control/quota-coordinator'

type QuotaBucket = { binding: string; tokens: number; updatedAtMs: number }

type FakeCoordinationState = {
  readonly quotas: Map<string, QuotaBucket>
  readonly bindings: Map<string, string>
  readonly leases: Map<string, Map<string, number>>
}

export type FakeGoogleCoordinationRedis = GoogleCoordinationRedis &
  FakeCoordinationState & {
    /** Every call rejects while true, as an unreachable Redis would. */
    fail: boolean
  }

type ScriptArguments = Readonly<{
  keys: readonly string[]
  values: ReadonlyArray<string | number>
}>

type BucketRequest = Readonly<{
  key: string
  binding: string
  capacity: number
  refillPerMs: number
  cost: number
}>

function bucketRequests({ keys, values }: ScriptArguments): BucketRequest[] {
  return keys.map((key, index) => {
    const offset = 2 + index * 5
    return {
      key,
      binding: String(values[offset]),
      capacity: Number(values[offset + 1]),
      refillPerMs: Number(values[offset + 2]),
      cost: Number(values[offset + 4]),
    }
  })
}

/** Refilled bucket state, or null when the key is bound to another binding. */
function refilled(
  state: FakeCoordinationState,
  request: BucketRequest,
  nowMs: number,
): QuotaBucket | null {
  const current = state.quotas.get(request.key) ?? {
    binding: request.binding,
    tokens: request.capacity,
    updatedAtMs: nowMs,
  }
  if (current.binding !== request.binding) return null
  const elapsedMs = Math.max(0, nowMs - current.updatedAtMs)
  return {
    binding: current.binding,
    tokens: Math.min(request.capacity, current.tokens + elapsedMs * request.refillPerMs),
    updatedAtMs: nowMs,
  }
}

function acquireQuota(state: FakeCoordinationState, args: ScriptArguments): unknown {
  const nowMs = Number(args.values[0])
  const requests = bucketRequests(args)
  const buckets = requests.map((request) => refilled(state, request, nowMs))
  if (buckets.some((bucket) => bucket === null)) return [-2, 0]
  const shortfalls = requests.map((request, index) => {
    const bucket = buckets[index] as QuotaBucket
    return bucket.tokens < request.cost
      ? Math.ceil((request.cost - bucket.tokens) / request.refillPerMs)
      : 0
  })
  const allowed = shortfalls.every((shortfall) => shortfall === 0)
  const remaining = requests.map((request, index) => {
    const bucket = buckets[index] as QuotaBucket
    const tokens = allowed ? bucket.tokens - request.cost : bucket.tokens
    state.quotas.set(request.key, { ...bucket, tokens })
    return tokens
  })
  return allowed ? [1, Math.floor(Math.min(...remaining))] : [0, Math.max(...shortfalls)]
}

function acquireInFlight(state: FakeCoordinationState, args: ScriptArguments): unknown {
  const [bindingKey = '', leasesKey = ''] = args.keys
  const [binding, nowRaw, limitRaw, leaseMsRaw, leaseId] = args.values
  const currentBinding = state.bindings.get(bindingKey)
  if (currentBinding && currentBinding !== String(binding)) return [-2, 0]
  const nowMs = Number(nowRaw)
  const leases = new Map(
    [...(state.leases.get(leasesKey) ?? new Map<string, number>())].filter(
      ([, expiry]) => expiry > nowMs,
    ),
  )
  if (leases.size >= Number(limitRaw)) {
    return [0, Math.max(1, Math.min(...leases.values()) - nowMs)]
  }
  const expiresAtMs = nowMs + Number(leaseMsRaw)
  state.bindings.set(bindingKey, String(binding))
  state.leases.set(leasesKey, leases.set(String(leaseId), expiresAtMs))
  return [1, expiresAtMs]
}

function releaseInFlight(state: FakeCoordinationState, args: ScriptArguments): unknown {
  const [bindingKey = '', leasesKey = ''] = args.keys
  const [binding, leaseId] = args.values
  if (state.bindings.get(bindingKey) !== String(binding)) return -2
  return state.leases.get(leasesKey)?.delete(String(leaseId)) ? 1 : 0
}

const SCRIPTS: ReadonlyArray<
  readonly [
    tag: string,
    run: (state: FakeCoordinationState, args: ScriptArguments) => unknown,
  ]
> = [
  ['-- google-quota-v2', acquireQuota],
  ['-- google-inflight-acquire-v1', acquireInFlight],
  ['-- google-inflight-release-v1', releaseInFlight],
]

export function createFakeGoogleCoordinationRedis(): FakeGoogleCoordinationRedis {
  const fake: FakeGoogleCoordinationRedis = {
    quotas: new Map(),
    bindings: new Map(),
    leases: new Map(),
    fail: false,
    eval: async (script, numberOfKeys, ...args) => {
      if (fake.fail) throw new Error('redis unavailable')
      const run = SCRIPTS.find(([tag]) => script.startsWith(tag))?.[1]
      if (!run) throw new Error('unexpected script')
      return run(fake, {
        keys: args.slice(0, numberOfKeys).map(String),
        values: args.slice(numberOfKeys),
      })
    },
  }
  return fake
}
