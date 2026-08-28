// BQR-2.2: Durable outbox consumers must be wired on the worker path.
// Finding 1.3 — registerInboxConsumers had zero callers.
// Static-source checks only (no cross-zone imports into contexts/).

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  clearConsumers,
  listRegisteredConsumers,
  registerConsumer,
} from '#/shared/outbox/consumer-registry'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { walk } from '#/shared/testing/source-tree'

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
  beforeEach(() => {
    clearConsumers()
  })

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

  it('listRegisteredConsumers is empty after clear', () => {
    registerConsumer({
      eventType: 'x.y',
      consumerName: 'c',
      module: 'inbox.outbox-consumers',
      handler: async () => ({ status: 'applied' }),
    })
    expect(listRegisteredConsumers()).toHaveLength(1)
    clearConsumers()
    expect(listRegisteredConsumers()).toEqual([])
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
