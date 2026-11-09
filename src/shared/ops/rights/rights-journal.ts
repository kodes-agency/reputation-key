// Journal hook for the manual rights script. Every apply writes one IDs-only
// entry per lifecycle context and scope to the erasure journal before the
// executor deletes anything. Without a store there is nothing to restore-replay
// from, so apply is refused. Ids and instants come from the plan, so a retry
// writes the same bytes to the same key.

import { createHash } from 'node:crypto'
import type { BackupErasureLedgerContext } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { ErasureJournalTargetKind } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  journalBeforeErasure,
  type ErasureJournalEntry,
} from '#/shared/db/lifecycle/erasure-journal.server'
import type { RightsRequestPlan } from './rights-request-command'

export type RightsJournalStore = Parameters<typeof journalBeforeErasure>[1]

/** The rows one journal entry names, so a restore can erase exactly those. */
export type RightsJournalTargets = Readonly<{
  kind: ErasureJournalTargetKind
  ids: ReadonlyArray<string>
}>

export type RightsJournal = Readonly<{
  /** Why an apply of these contexts cannot be journaled, or null when it can. */
  check: (
    plan: RightsRequestPlan,
    contexts: ReadonlyArray<BackupErasureLedgerContext>,
  ) => string | null
  /** The journal entry ids, one per context, in write order. */
  entryIds: (
    plan: RightsRequestPlan,
    contexts: ReadonlyArray<BackupErasureLedgerContext>,
  ) => ReadonlyArray<string>
  /** Writes every entry, then calls erase; a rejected write means erase never runs. */
  run: <T>(
    plan: RightsRequestPlan,
    contexts: ReadonlyArray<BackupErasureLedgerContext>,
    erase: () => Promise<T>,
  ) => Promise<T>
  /** Writes one entry naming the batch's rows, then calls erase. */
  runBatch: <T>(
    plan: RightsRequestPlan,
    context: BackupErasureLedgerContext,
    targets: RightsJournalTargets,
    erase: () => Promise<T>,
  ) => Promise<T>
}>

const EVIDENCE_REF = 'rights-request:v1'
const LIFECYCLE_REVISION = 1

/** A version-5-shaped UUID from the SHA-256 of the seed. */
function derivedUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function seedOf(
  plan: RightsRequestPlan,
  context: BackupErasureLedgerContext,
  kind: string,
  targets?: RightsJournalTargets,
): string {
  return [
    kind,
    context,
    plan.scope,
    plan.organizationId,
    plan.propertyId ?? '',
    plan.subjectRef ?? '',
    plan.responseId ?? '',
    plan.verificationRef ?? '',
    plan.receivedAt?.toISOString() ?? '',
    targets ? `${targets.kind}:${[...targets.ids].sort().join(',')}` : '',
  ].join('|')
}

/** A response has no verified subject, so its id stands in as the subject reference. */
function guestResponseEntry(
  base: Omit<ErasureJournalEntry, 'subjectClass'>,
  plan: RightsRequestPlan,
): ErasureJournalEntry | { error: string } {
  if (!plan.propertyId) return { error: '--property is required to journal this apply' }
  if (!plan.responseId)
    return { error: 'response=<uuid> is required to journal this apply' }
  return {
    ...base,
    subjectClass: 'privacy_subject',
    propertyId: plan.propertyId,
    subjectRef:
      plan.subjectRef ?? createHash('sha256').update(plan.responseId).digest('hex'),
    journalTargets: { kind: 'guest_response', ids: [plan.responseId] },
  }
}

export function rightsJournalEntry(
  plan: RightsRequestPlan,
  context: BackupErasureLedgerContext,
  targets?: RightsJournalTargets,
): ErasureJournalEntry | { error: string } {
  const effectiveErasureAt = plan.verifiedAt ?? plan.receivedAt
  if (!effectiveErasureAt)
    return { error: 'received=<iso> is required to journal an apply' }
  const base = {
    id: derivedUuid(seedOf(plan, context, 'entry', targets)),
    recordedBeforeErasure: true as const,
    context,
    closureLineageId: derivedUuid(seedOf(plan, context, 'lineage', targets)),
    lifecycleRevision: LIFECYCLE_REVISION,
    effectiveErasureAt,
    erasedRowCount: 0,
    evidenceRef: EVIDENCE_REF,
    organizationId: plan.organizationId,
    ...(targets ? { journalTargets: { kind: targets.kind, ids: targets.ids } } : {}),
  }
  if (plan.scope === 'organization') return { ...base, subjectClass: 'organization' }
  if (plan.scope === 'property') {
    return plan.propertyId
      ? { ...base, subjectClass: 'property', propertyId: plan.propertyId }
      : { error: '--property is required to journal a Property apply' }
  }
  if (plan.scope === 'guest-response') return guestResponseEntry(base, plan)
  return plan.subjectRef
    ? { ...base, subjectClass: 'privacy_subject', subjectRef: plan.subjectRef }
    : { error: 'subject-ref=<sha256> is required to journal this apply' }
}

function entriesOf(
  plan: RightsRequestPlan,
  contexts: ReadonlyArray<BackupErasureLedgerContext>,
): ReadonlyArray<ErasureJournalEntry> {
  return contexts.map((context) => {
    const entry = rightsJournalEntry(plan, context)
    if ('error' in entry) throw new Error(entry.error)
    return entry
  })
}

/** Without a store every apply is refused. */
export function createRightsJournal(
  store: RightsJournalStore | undefined,
): RightsJournal {
  return Object.freeze({
    check(plan, contexts) {
      if (!store) return 'no erasure journal store is configured; apply is refused'
      try {
        entriesOf(plan, contexts)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : 'invalid journal entry'
      }
    },
    entryIds: (plan, contexts) => entriesOf(plan, contexts).map(({ id }) => id),
    async run(plan, contexts, erase) {
      if (!store) throw new Error('no erasure journal store is configured')
      const entries = entriesOf(plan, contexts)
      const write = entries.reduceRight<() => ReturnType<typeof erase>>(
        (next, entry) => () => journalBeforeErasure(entry, store, next),
        erase,
      )
      return write()
    },
    async runBatch(plan, context, targets, erase) {
      if (!store) throw new Error('no erasure journal store is configured')
      const entry = rightsJournalEntry(plan, context, targets)
      if ('error' in entry) throw new Error(entry.error)
      return journalBeforeErasure(entry, store, erase)
    },
  })
}
