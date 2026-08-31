// BQR-2.2: Durable outbox consumers must be wired on the worker path.
// Finding 1.3 — registerInboxConsumers had zero callers.
// Static-source checks only (no cross-zone imports into contexts/).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { walk } from '#/shared/testing/source-tree'
import { createContainer, type Container } from '#/composition'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'

const ROOT = process.cwd()

type DiscoveredRegistration = Readonly<{
  file: string
  consumerName: string
  module: string | undefined
}>

/**
 * Every registerConsumer({ ... }) call in production source, with the
 * consumerName and the catalogue module it declares. Parsed from the head of
 * each call object (everything up to `handler:`) so a multi-line handler body
 * can never be mistaken for the next registration's fields.
 */
function discoverRegistrations(): ReadonlyArray<DiscoveredRegistration> {
  const out: DiscoveredRegistration[] = []
  const files = walk(join(ROOT, 'src')).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  )
  for (const abs of files) {
    const src = readFileSync(abs, 'utf-8')
    const file = relative(ROOT, abs)
    for (const m of src.matchAll(/registerConsumer\(\s*\{/g)) {
      const from = m.index + m[0].length
      const handlerAt = src.indexOf('handler:', from)
      const head = src.slice(from, handlerAt === -1 ? src.length : handlerAt)
      const consumerName = /consumerName:\s*'([^']+)'/.exec(head)?.[1]
      if (consumerName === undefined) continue
      out.push({ file, consumerName, module: /module:\s*'([^']+)'/.exec(head)?.[1] })
    }
  }
  return out
}

/** Consumer-module rows the delayed-execution gate can resolve an action for. */
const CATALOGUE_CONSUMER_MODULES: ReadonlySet<string> = new Set(
  ENTRY_POINT_CATALOGUE.filter((r) => r.kind === 'consumer').map((r) => r.name),
)

describe('BQR-2.2: outbox consumer registration', () => {
  it('worker wires registerOutboxConsumers when outbox is available', () => {
    const workerSrc = readFileSync(join(ROOT, 'src/worker/index.ts'), 'utf-8')
    expect(workerSrc).toContain('registerOutboxConsumers')
    expect(workerSrc).toContain('container.outboxRepo')
  })

  it('composition exposes registerOutboxConsumers wired to registerInboxConsumers', () => {
    const compositionSrc = readFileSync(join(ROOT, 'src/composition.ts'), 'utf-8')
    expect(compositionSrc).toContain('registerOutboxConsumers')
    // BQC-5.2: the inbox build module owns the registrar — the root surfaces
    // it without importing the consumer registration itself.
    const inboxBuildSrc = readFileSync(join(ROOT, 'src/contexts/inbox/build.ts'), 'utf-8')
    expect(inboxBuildSrc).toContain('registerInboxConsumers')
    expect(inboxBuildSrc).toContain('registerGuestFeedbackConsumer')
    expect(compositionSrc).toContain('inbox.worker.registerOutboxConsumers')
  })

  it('inbox outbox-consumers registers review and Guest feedback projections', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/outbox-consumers.ts'),
      'utf-8',
    )
    const guestSrc = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/guest-feedback-outbox-consumers.ts'),
      'utf-8',
    )
    expect(src).toContain("eventType: 'review.created'")
    expect(src).toContain("consumerName: 'inbox.on-review-created'")
    expect(src).toContain("eventType: 'review.expired'")
    expect(src).toContain("consumerName: 'inbox.on-review-expired'")
    // BQC-3.4: metadata-only refresh consumer (resolves the BQC-3.1 orphan).
    expect(src).toContain("eventType: 'review.updated'")
    expect(src).toContain("consumerName: 'inbox.on-review-updated'")
    // REV-01: stable Inbox identity receives a content-free source transition.
    expect(src).toContain("eventType: 'review.source_transitioned'")
    expect(src).toContain("consumerName: 'inbox.on-review-source-transitioned'")
    // Compatibility receipt plus the observation-authority close/reopen consumer.
    expect(src).toContain("eventType: 'review.reply.published'")
    expect(src).toContain("consumerName: 'inbox.on-reply-published'")
    expect(src).toContain("eventType: 'review.reply.observed'")
    expect(src).toContain("consumerName: 'inbox.on-reply-observed'")
    expect(guestSrc).toContain("eventType: 'guest.feedback.submitted'")
    expect(guestSrc).toContain("consumerName: 'inbox.on-guest-feedback-submitted'")
    expect(guestSrc).toContain("eventType: 'guest.feedback.retracted'")
    expect(guestSrc).toContain("consumerName: 'inbox.on-guest-feedback-retracted'")
  })

  it('worker composition wires the Review publication-intent recovery consumer', () => {
    const compositionSrc = readFileSync(join(ROOT, 'src/composition.ts'), 'utf-8')
    const reviewBuildSrc = readFileSync(
      join(ROOT, 'src/contexts/review/build.ts'),
      'utf-8',
    )
    const consumerSrc = readFileSync(
      join(ROOT, 'src/contexts/review/infrastructure/outbox-consumers.ts'),
      'utf-8',
    )

    expect(compositionSrc).toContain('review.worker.registerOutboxConsumers')
    expect(reviewBuildSrc).toContain('registerReplyPublicationConsumers')
    expect(consumerSrc).toContain("eventType: 'review.reply.publication_requested'")
    expect(consumerSrc).toContain("consumerName: 'review.on-reply-publication-requested'")
  })

  it('a registry lists what was registered on it and nothing after clear', () => {
    const consumerRegistry = createConsumerRegistry()
    consumerRegistry.registerConsumer({
      eventType: 'x.y',
      consumerName: 'c',
      module: 'inbox.outbox-consumers',
      handler: async () => ({ status: 'applied' }),
    })
    expect(consumerRegistry.list()).toHaveLength(1)
    consumerRegistry.clear()
    expect(consumerRegistry.list()).toEqual([])
  })

  it('BQR-2.4 / BQC-3.4: consumers perform real projection work via applyOnce', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/outbox-consumers.ts'),
      'utf-8',
    )
    const guestSrc = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/guest-feedback-outbox-consumers.ts'),
      'utf-8',
    )
    expect(src).toContain('handleInboxReviewCreated')
    expect(src).toContain('handleInboxReviewExpired')
    expect(src).toContain('handleInboxReviewUpdated')
    expect(src).toContain('handleInboxReplyPublished')
    expect(src).toContain('handleInboxReplyObserved')
    expect(src).toContain('applyReviewProjectionOnce')
    expect(guestSrc).toContain('applySourceCreatedOnce')
    expect(guestSrc).toContain('applySourceWithdrawnOnce')
    expect(src).toContain('applyReviewSourceTransitionedOnce')
    expect(src).toContain('applyReplyObservedOnce')
    // BQC-1.2: no denormalized-field syncing remains.
    expect(src).not.toContain('syncDenormalizedFields')
    expect(src).not.toMatch(/TODO: Implement inbox item update/)
    expect(src).not.toMatch(/for now, mark as applied/i)
  })

  // ── Consumer authorization attribution ────────────────────────────
  //
  // gateDispatcherConsumer resolves the policy action from the consumer's
  // MODULE (CONSUMER_ROW_BY_NAME.get(module)), so a registration that names a
  // module with no catalogue row silently falls back to the raw string as the
  // action — and one that names ANOTHER context's row is authorized under that
  // context's capability. Both are authorization defects, not lint nits.
  describe('registration modules resolve to catalogue consumer rows', () => {
    it('discovers every durable registration in production source', () => {
      const registrations = discoverRegistrations()
      expect(registrations.length).toBeGreaterThanOrEqual(15)
      expect(CATALOGUE_CONSUMER_MODULES.size).toBeGreaterThan(0)
    })

    it('every registerConsumer call declares a module', () => {
      const missing = discoverRegistrations()
        .filter((r) => r.module === undefined)
        .map((r) => `${r.file}: ${r.consumerName}`)
      expect(missing).toEqual([])
    })

    it('every declared module is a real catalogue consumer row', () => {
      const unresolved = discoverRegistrations()
        .filter((r) => r.module !== undefined)
        .filter((r) => !CATALOGUE_CONSUMER_MODULES.has(r.module as string))
        .map((r) => `${r.file}: ${r.consumerName} → ${r.module as string}`)
      expect(unresolved).toEqual([])
    })

    it('each context registers under a module whose catalogue row is its own file', () => {
      const rowFileByModule: Record<string, string> = Object.fromEntries(
        ENTRY_POINT_CATALOGUE.filter((r) => r.kind === 'consumer').map((r) => [
          r.name,
          r.file,
        ]),
      )
      const misattributed = discoverRegistrations()
        .filter((r) => r.file.startsWith('src/contexts/'))
        .filter((r) => r.module !== undefined)
        .filter((r) => rowFileByModule[r.module as string] !== r.file)
        .map((r) => `${r.file}: ${r.consumerName} → ${r.module as string}`)
      expect(misattributed).toEqual([])
    })
  })
})

// ARC-03-T7 — the consumer registry is container-scoped.
//
// The old module-level Map made duplicate detection process-wide, so a SECOND
// container in one process could not register its consumers at all: every
// registration collided with the first container's. These tests pin the fix
// end to end — two real containers, both fully registered, each reading only
// its own registry.
describe('ARC-03-T7: container-scoped consumer registry', () => {
  const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')
  const clock: Clock = () => FIXED_DATE

  /** Query-free guard: any DB access during construction throws. */
  const dbStub = new Proxy(
    {},
    {
      get: () => {
        throw new Error('composition must not query the DB during construction')
      },
    },
  ) as unknown as Database

  function build(): Container {
    clearEventSchemas()
    return createContainer({
      clock,
      queue: createInMemoryQueue({ clock }),
      backgroundQueue: createInMemoryQueue({ clock }),
      opsDomainEventsQueue: createInMemoryQueue({ clock }),
      opsQuarantineQueue: createInMemoryQueue({ clock }),
      redis: undefined,
      enableJobs: true,
      db: dbStub,
      identityPort: createInMemoryIdentityPort(),
      email: async () => {},
    })
  }

  it('lets two containers in one process both register every consumer', async () => {
    const containerA = build()
    const containerB = build()

    expect(() => containerA.registerOutboxConsumers()).not.toThrow()
    expect(() => containerB.registerOutboxConsumers()).not.toThrow()

    expect(containerA.consumerRegistry).not.toBe(containerB.consumerRegistry)
    expect(containerA.consumerRegistry.list()).toEqual(containerB.consumerRegistry.list())
    expect(containerA.consumerRegistry.list().length).toBeGreaterThan(0)

    await containerA.shutdown.run()
    await containerB.shutdown.run()
  })

  it('holds no module-level registration state and exports no free registrar', () => {
    const registrySrc = readFileSync(
      resolve('src/shared/outbox/consumer-registry.ts'),
      'utf8',
    )
    const barrelSrc = readFileSync(resolve('src/shared/outbox/index.ts'), 'utf8')

    expect(registrySrc).not.toMatch(/^const consumersByType/m)
    expect(registrySrc).toContain('export function createConsumerRegistry')
    expect(barrelSrc).not.toMatch(/^export \{[^}]*\bregisterConsumer\b/m)
    expect(barrelSrc).toContain(
      "export { createConsumerRegistry } from './consumer-registry'",
    )
  })

  it('checks the Notification trigger matrix against the injected registry', () => {
    const notificationBuild = readFileSync(
      resolve('src/contexts/notification/build.ts'),
      'utf8',
    )

    expect(notificationBuild).toContain(
      'assertBetaNotificationTriggerMatrix(consumerRegistry.list())',
    )
    expect(notificationBuild).not.toContain('listRegisteredConsumers')
  })

  it('gates worker readiness on the container registry rather than a global default', () => {
    const readiness = readFileSync(resolve('src/shared/jobs/readiness.ts'), 'utf8')
    const worker = readFileSync(resolve('src/worker/index.ts'), 'utf8')

    // Required, not optional: no `listConsumers?:` and no ambient fallback.
    expect(readiness).toContain('listConsumers: () => ReadonlyArray<ConsumerListing>')
    expect(readiness).not.toContain('listConsumers?:')
    expect(readiness).not.toContain('listRegisteredConsumers')
    expect(worker).toContain('listConsumers: container.consumerRegistry.list')
    expect(worker).toContain('consumers: container.consumerRegistry')
  })
})
