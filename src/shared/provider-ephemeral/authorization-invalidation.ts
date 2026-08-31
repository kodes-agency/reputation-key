import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import type { ProviderEphemeralStore } from './provider-ephemeral-store'

const DEDUPE_TTL_SECONDS = 86_400
const PROCESSING_LEASE_MS = 30_000
const OWNER = /^[A-Za-z0-9_-]{43}$/
const HANDLER_ID = /^[a-z][a-z0-9_-]{0,63}$/
const PROVIDER_AUTHORIZATION_INVALIDATION_HANDLER_SET_VERSION =
  'provider-authorization-invalidation-v1' as const

const invalidationSchema = z
  .object({
    eventId: z.uuid(),
    kind: z.enum([
      'connection_authority_changed',
      'property_binding_changed',
      'membership_authority_changed',
      'capability_authority_changed',
    ]),
    organizationId: z.string().min(1).max(255),
    propertyId: z.uuid().nullable(),
    connectionId: z.uuid().nullable(),
    sourceEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict()

const markerSchema = z
  .object({
    schemaVersion: z.literal(2),
    handlerSetVersion: z.literal(PROVIDER_AUTHORIZATION_INVALIDATION_HANDLER_SET_VERSION),
    handlerSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['ready', 'processing', 'complete']),
    owner: z.string().regex(OWNER).nullable(),
    lockUntilMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    completedHandlerIds: z.array(z.string().regex(HANDLER_ID)).max(32),
  })
  .strict()

export type ProviderAuthorizationInvalidation = Readonly<
  z.infer<typeof invalidationSchema>
>

export type ProviderAuthorizationInvalidationHandler = Readonly<{
  id: string
  /** Must be idempotent across a crash between effect and durable receipt. */
  invalidate: (event: ProviderAuthorizationInvalidation) => Promise<void>
}>

export type ProviderAuthorizationInvalidationReceipts = Readonly<{
  hasReceipt: (eventId: string, consumerName: string) => Promise<boolean>
  insertReceipt: (
    eventId: string,
    consumerName: string,
    status: 'applied',
  ) => Promise<void>
}>

export type ProviderAuthorizationInvalidationResult =
  | Readonly<{ ok: true; status: 'delivered' | 'duplicate' }>
  | Readonly<{
      ok: false
      code:
        | 'malformed'
        | 'payload_mismatch'
        | 'handler_set_mismatch'
        | 'in_progress'
        | 'runtime_unavailable'
    }>

export type ProviderAuthorizationInvalidationFanout = Readonly<{
  dispatch: (
    event: ProviderAuthorizationInvalidation,
    nowMs: number,
  ) => Promise<ProviderAuthorizationInvalidationResult>
}>

function canonicalPayload(event: ProviderAuthorizationInvalidation): string {
  return JSON.stringify({
    eventId: event.eventId,
    kind: event.kind,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    connectionId: event.connectionId,
    sourceEpoch: event.sourceEpoch,
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function dedupeKey(eventId: string): string {
  return createHash('sha256')
    .update(PROVIDER_AUTHORIZATION_INVALIDATION_HANDLER_SET_VERSION, 'utf8')
    .update('\0', 'utf8')
    .update(eventId, 'utf8')
    .digest('base64url')
}

function handlerReceiptName(handlerId: string): string {
  return `${PROVIDER_AUTHORIZATION_INVALIDATION_HANDLER_SET_VERSION}.${handlerId}`
}

export function createProviderAuthorizationInvalidationFanout(
  deps: Readonly<{
    store: ProviderEphemeralStore
    /** Durable authority; eventId must identify the source outbox row. */
    receipts: ProviderAuthorizationInvalidationReceipts
    handlers: readonly ProviderAuthorizationInvalidationHandler[]
    randomOwner: () => string
    ensureRuntimeReady?: () => Promise<void>
  }>,
): ProviderAuthorizationInvalidationFanout {
  const ids = deps.handlers.map((handler) => handler.id)
  if (
    ids.length === 0 ||
    ids.length > 32 ||
    ids.some((id) => !HANDLER_ID.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('provider authorization invalidation handlers are invalid')
  }
  const handlerSetSha256 = sha256(JSON.stringify([...ids].sort()))

  return Object.freeze({
    dispatch: async (candidate, nowMs) => {
      const parsedEvent = invalidationSchema.safeParse(candidate)
      const owner = deps.randomOwner()
      if (
        !parsedEvent.success ||
        !Number.isSafeInteger(nowMs) ||
        nowMs < 0 ||
        !OWNER.test(owner)
      ) {
        return { ok: false, code: 'malformed' }
      }
      try {
        await deps.ensureRuntimeReady?.()
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }

      const event = parsedEvent.data
      const key = dedupeKey(event.eventId)
      const payloadSha256 = sha256(canonicalPayload(event))
      let observed: string
      try {
        const initial = markerSchema.parse({
          schemaVersion: 2,
          handlerSetVersion: PROVIDER_AUTHORIZATION_INVALIDATION_HANDLER_SET_VERSION,
          handlerSetSha256,
          payloadSha256,
          state: 'ready',
          owner: null,
          lockUntilMs: null,
          completedHandlerIds: [],
        })
        const initialEncoded = JSON.stringify(initial)
        const inserted = await deps.store.putIfAbsent(
          'invalidation-dedupe',
          key,
          initialEncoded,
          DEDUPE_TTL_SECONDS,
        )
        observed = inserted
          ? initialEncoded
          : ((await deps.store.read('invalidation-dedupe', key)) ?? '')
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
      if (!observed) return { ok: false, code: 'runtime_unavailable' }

      let markerCandidate: unknown
      try {
        markerCandidate = JSON.parse(observed)
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
      const parsedMarker = markerSchema.safeParse(markerCandidate)
      if (!parsedMarker.success) {
        return { ok: false, code: 'runtime_unavailable' }
      }
      const marker = parsedMarker.data
      if (marker.payloadSha256 !== payloadSha256) {
        return { ok: false, code: 'payload_mismatch' }
      }
      if (marker.handlerSetSha256 !== handlerSetSha256) {
        return { ok: false, code: 'handler_set_mismatch' }
      }
      if (marker.state === 'complete') return { ok: true, status: 'duplicate' }
      if (
        marker.state === 'processing' &&
        marker.lockUntilMs !== null &&
        marker.lockUntilMs > nowMs
      ) {
        return { ok: false, code: 'in_progress' }
      }

      let owned = markerSchema.parse({
        ...marker,
        state: 'processing',
        owner,
        lockUntilMs: nowMs + PROCESSING_LEASE_MS,
      })
      let ownedEncoded = JSON.stringify(owned)
      try {
        const acquired = await deps.store.replaceIfEquals(
          'invalidation-dedupe',
          key,
          observed,
          ownedEncoded,
          DEDUPE_TTL_SECONDS,
        )
        if (acquired !== 'replaced') return { ok: false, code: 'in_progress' }

        let deliveredHandler = false
        for (const handler of deps.handlers) {
          if (owned.completedHandlerIds.includes(handler.id)) continue
          const consumerName = handlerReceiptName(handler.id)
          try {
            const alreadyDelivered = await deps.receipts.hasReceipt(
              event.eventId,
              consumerName,
            )
            if (!alreadyDelivered) {
              await handler.invalidate(event)
              await deps.receipts.insertReceipt(event.eventId, consumerName, 'applied')
              deliveredHandler = true
            }
          } catch {
            const released = markerSchema.parse({
              ...owned,
              state: 'ready',
              owner: null,
              lockUntilMs: null,
            })
            await deps.store.replaceIfEquals(
              'invalidation-dedupe',
              key,
              ownedEncoded,
              JSON.stringify(released),
              DEDUPE_TTL_SECONDS,
            )
            return { ok: false, code: 'runtime_unavailable' }
          }
          const completed = markerSchema.parse({
            ...owned,
            completedHandlerIds: [...owned.completedHandlerIds, handler.id],
          })
          const completedEncoded = JSON.stringify(completed)
          const recorded = await deps.store.replaceIfEquals(
            'invalidation-dedupe',
            key,
            ownedEncoded,
            completedEncoded,
            DEDUPE_TTL_SECONDS,
          )
          if (recorded !== 'replaced') {
            return { ok: false, code: 'in_progress' }
          }
          owned = completed
          ownedEncoded = completedEncoded
        }

        const complete = markerSchema.parse({
          ...owned,
          state: 'complete',
          owner: null,
          lockUntilMs: null,
        })
        const finalized = await deps.store.replaceIfEquals(
          'invalidation-dedupe',
          key,
          ownedEncoded,
          JSON.stringify(complete),
          DEDUPE_TTL_SECONDS,
        )
        return finalized === 'replaced'
          ? {
              ok: true,
              status: deliveredHandler ? 'delivered' : 'duplicate',
            }
          : { ok: false, code: 'in_progress' }
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
    },
  })
}
