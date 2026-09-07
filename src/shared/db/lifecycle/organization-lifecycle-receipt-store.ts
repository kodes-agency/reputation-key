// Shared, transaction-bound Organization lifecycle event store (LIF-01).
//
// Every lifecycle receipt is appended here. Context contributors, Identity
// commands, Property erasure, and backup hold releases share one durable table
// while retaining their former idempotency keys in a namespaced `kind` value.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { backupErasureLedger } from '#/shared/db/schema/backup-erasure-ledger.schema'
import {
  organizationLifecycleAuthority,
  organizationLifecycleEvents,
  type OrganizationLifecycleEventContext,
} from '#/shared/db/schema/organization-lifecycle.schema'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'

export type OrganizationLifecycleContributionRequest = Readonly<{
  organizationId: string
  closureLineageId: string
  lifecycleRevision: number
  recoverableUntil: Date
  occurredAt: Date
}>

export type OrganizationLifecycleReceiptPhase = 'closing' | 'purge_readiness' | 'purge'
export type OrganizationLifecycleReceiptOutcome = 'complete' | 'no_data'

export type OrganizationLifecyclePhaseOutcome = Readonly<{
  outcome: OrganizationLifecycleReceiptOutcome
  evidenceRef: string
}>

export type OrganizationLifecyclePhaseWork = (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
) => Promise<OrganizationLifecyclePhaseOutcome>

export type OrganizationLifecycleReceiptStore = Readonly<{
  context: OrganizationLifecycleEventContext
  run(
    phase: OrganizationLifecycleReceiptPhase,
    work: OrganizationLifecyclePhaseWork,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome>
}>

export type OrganizationLifecycleReceiptStoreDeps = Readonly<{
  db: Database
  context: OrganizationLifecycleEventContext
}>

const AUTHORITY_STATE_BY_PHASE = Object.freeze({
  closing: 'closure_requested',
  purge_readiness: 'closing',
  purge: 'purging',
} as const)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u
const LIFECYCLE_AUTHORITY_CHANGED = 'lifecycle contribution authority changed'
const CONTRIBUTION_KIND_PREFIX = 'organization_lifecycle_contribution'
const COMMAND_KIND_PREFIX = 'organization_lifecycle_command'
const PROPERTY_ERASE_KIND_PREFIX = 'property_erase'
const BACKUP_HOLD_RELEASE_KIND_PREFIX = 'backup_erasure_hold_release'

const contributionKind = (closureLineageId: string, lifecycleRevision: number): string =>
  `${CONTRIBUTION_KIND_PREFIX}:${closureLineageId}:r${lifecycleRevision}`
const commandKind = (operationId: string): string =>
  `${COMMAND_KIND_PREFIX}:${operationId}`
const propertyEraseKind = (authorityId: string): string =>
  `${PROPERTY_ERASE_KIND_PREFIX}:${authorityId}`
const backupHoldReleaseKind = (ledgerEntryId: string): string =>
  `${BACKUP_HOLD_RELEASE_KIND_PREFIX}:${ledgerEntryId}`

function objectPayload(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} payload is invalid`)
  }
  return value as Record<string, unknown>
}

function requiredString(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): string {
  const value = payload[key]
  if (typeof value !== 'string') throw new Error(`${subject} payload is invalid`)
  return value
}

function nullableString(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): string | null {
  const value = payload[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${subject} payload is invalid`)
  return value
}

function requiredInteger(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): number {
  const value = payload[key]
  if (!Number.isSafeInteger(value)) throw new Error(`${subject} payload is invalid`)
  return value as number
}

function requiredBoolean(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): boolean {
  const value = payload[key]
  if (typeof value !== 'boolean') throw new Error(`${subject} payload is invalid`)
  return value
}

function requiredDate(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): Date {
  const value = requiredString(payload, key, subject)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${subject} payload is invalid`)
  return date
}

function nullableDate(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): Date | null {
  const value = nullableString(payload, key, subject)
  if (value === null) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${subject} payload is invalid`)
  return date
}

export function lifecycleRequestFingerprint(
  context: OrganizationLifecycleEventContext,
  phase: OrganizationLifecycleReceiptPhase,
  request: OrganizationLifecycleContributionRequest,
): string {
  return sha256Hex(
    canonicalizeRfc8785({
      context,
      phase,
      organizationId: request.organizationId,
      closureLineageId: request.closureLineageId,
      lifecycleRevision: request.lifecycleRevision,
      recoverableUntil: request.recoverableUntil.toISOString(),
    }),
  )
}

export function validateContentFreeEvidenceRef(value: string): string {
  if (value.length > 200) {
    throw new Error('Lifecycle evidence reference must be at most 200 characters')
  }
  if (!CONTENT_FREE_EVIDENCE_REF.test(value)) {
    throw new Error('Lifecycle evidence reference must be a content-free identifier')
  }
  return value
}

function validateRequest(request: OrganizationLifecycleContributionRequest): void {
  if (!UUID.test(request.closureLineageId)) {
    throw new Error('Lifecycle closure lineage must be a UUID')
  }
  if (!Number.isSafeInteger(request.lifecycleRevision) || request.lifecycleRevision < 1) {
    throw new Error('Lifecycle revision must be a positive safe integer')
  }
  if (
    Number.isNaN(request.recoverableUntil.getTime()) ||
    Number.isNaN(request.occurredAt.getTime())
  ) {
    throw new Error('Lifecycle contribution timestamps must be valid')
  }
}

function validateOutcome(
  result: OrganizationLifecyclePhaseOutcome,
): OrganizationLifecyclePhaseOutcome {
  if (result.outcome !== 'complete' && result.outcome !== 'no_data') {
    throw new Error('Lifecycle contribution outcome is invalid')
  }
  return {
    outcome: result.outcome,
    evidenceRef: validateContentFreeEvidenceRef(result.evidenceRef),
  }
}

function contributionFromPayload(
  value: unknown,
): OrganizationLifecyclePhaseOutcome & Readonly<{ requestFingerprint: string }> {
  const payload = objectPayload(value, 'Organization lifecycle contribution')
  const outcome = requiredString(
    payload,
    'outcome',
    'Organization lifecycle contribution',
  )
  return {
    requestFingerprint: requiredString(
      payload,
      'requestFingerprint',
      'Organization lifecycle contribution',
    ),
    ...validateOutcome({
      outcome: outcome as OrganizationLifecycleReceiptOutcome,
      evidenceRef: requiredString(
        payload,
        'evidenceRef',
        'Organization lifecycle contribution',
      ),
    }),
  }
}

export const createOrganizationLifecycleReceiptStore = (
  deps: OrganizationLifecycleReceiptStoreDeps,
): OrganizationLifecycleReceiptStore => {
  const run = async (
    phase: OrganizationLifecycleReceiptPhase,
    work: OrganizationLifecyclePhaseWork,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    validateRequest(request)
    const fingerprint = lifecycleRequestFingerprint(deps.context, phase, request)
    const kind = contributionKind(request.closureLineageId, request.lifecycleRevision)
    const lockKey = [
      'repkey',
      'context-organization-lifecycle',
      deps.context,
      request.closureLineageId,
      request.lifecycleRevision,
      phase,
    ].join(':')

    return deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
      const existing = await tx
        .select({
          organizationId: organizationLifecycleEvents.organizationId,
          payload: organizationLifecycleEvents.payload,
        })
        .from(organizationLifecycleEvents)
        .where(
          and(
            eq(organizationLifecycleEvents.context, deps.context),
            eq(organizationLifecycleEvents.phase, phase),
            eq(organizationLifecycleEvents.kind, kind),
          ),
        )
        .limit(1)

      if (existing[0]) {
        const recorded = contributionFromPayload(existing[0].payload)
        if (
          existing[0].organizationId !== request.organizationId ||
          recorded.requestFingerprint !== fingerprint
        ) {
          throw new Error(LIFECYCLE_AUTHORITY_CHANGED)
        }
        return { outcome: recorded.outcome, evidenceRef: recorded.evidenceRef }
      }

      const authorities = await tx
        .select({
          state: organizationLifecycleAuthority.state,
          revision: organizationLifecycleAuthority.revision,
          closureLineageId: organizationLifecycleAuthority.closureLineageId,
          recoverableUntil: organizationLifecycleAuthority.recoverableUntil,
          lastTransitionAt: organizationLifecycleAuthority.lastTransitionAt,
        })
        .from(organizationLifecycleAuthority)
        .where(eq(organizationLifecycleAuthority.organizationId, request.organizationId))
        .limit(1)
        .for('update')
      const authority = authorities[0]
      if (
        !authority ||
        authority.state !== AUTHORITY_STATE_BY_PHASE[phase] ||
        authority.revision !== request.lifecycleRevision ||
        authority.closureLineageId !== request.closureLineageId ||
        authority.recoverableUntil?.getTime() !== request.recoverableUntil.getTime() ||
        request.occurredAt.getTime() < authority.lastTransitionAt.getTime()
      ) {
        throw new Error(LIFECYCLE_AUTHORITY_CHANGED)
      }

      const result = validateOutcome(await work(tx, request))
      await tx.insert(organizationLifecycleEvents).values({
        organizationId: request.organizationId,
        context: deps.context,
        phase,
        kind,
        payload: {
          closureLineageId: request.closureLineageId,
          lifecycleRevision: request.lifecycleRevision,
          requestFingerprint: fingerprint,
          outcome: result.outcome,
          evidenceRef: result.evidenceRef,
          recoverableUntil: request.recoverableUntil.toISOString(),
        },
        recordedAt: request.occurredAt,
      })
      return result
    })
  }

  return Object.freeze({ context: deps.context, run })
}

export type OrganizationLifecyclePhaseWorkSet = Readonly<{
  prepareClosing: OrganizationLifecyclePhaseWork
  verifyPurgeReadiness: OrganizationLifecyclePhaseWork
  purge: OrganizationLifecyclePhaseWork
}>

export const createOrganizationLifecycleContributorScaffold = (
  deps: OrganizationLifecycleReceiptStoreDeps & OrganizationLifecyclePhaseWorkSet,
) => {
  const store = createOrganizationLifecycleReceiptStore({
    db: deps.db,
    context: deps.context,
  })
  return Object.freeze({
    context: deps.context,
    prepareClosing: (request: OrganizationLifecycleContributionRequest) =>
      store.run('closing', deps.prepareClosing, request),
    verifyPurgeReadiness: (request: OrganizationLifecycleContributionRequest) =>
      store.run('purge_readiness', deps.verifyPurgeReadiness, request),
    purge: (request: OrganizationLifecycleContributionRequest) =>
      store.run('purge', deps.purge, request),
  })
}

export type OrganizationLifecycleCommandEventOperation =
  'request' | 'cancel' | 'reactivate'

export type OrganizationLifecycleCommandEventStatus = Readonly<{
  organizationId: string
  state: string
  revision: number
  closureLineageId: string | null
  closureRequestedAt: Date | null
  recoverableUntil: Date | null
  irreversibleAt: Date | null
  closedAt: Date | null
  reactivationRequired: boolean
  lastTransitionAt: Date
  lastActorId: string
  lastReasonCode: string
  lastSupportEvidenceRef: string
}>

export type OrganizationLifecycleCommandEvent = Readonly<{
  operationId: string
  operation: OrganizationLifecycleCommandEventOperation
  status: OrganizationLifecycleCommandEventStatus
}>

export async function readOrganizationLifecycleCommandEvent(
  tx: Tx,
  operationId: string,
): Promise<OrganizationLifecycleCommandEvent | null> {
  const rows = await tx
    .select({
      organizationId: organizationLifecycleEvents.organizationId,
      payload: organizationLifecycleEvents.payload,
    })
    .from(organizationLifecycleEvents)
    .where(
      and(
        eq(organizationLifecycleEvents.context, 'identity'),
        eq(organizationLifecycleEvents.phase, 'command'),
        eq(organizationLifecycleEvents.kind, commandKind(operationId)),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const subject = 'Organization lifecycle command'
  const payload = objectPayload(row.payload, subject)
  const operation = requiredString(payload, 'operation', subject)
  if (operation !== 'request' && operation !== 'cancel' && operation !== 'reactivate') {
    throw new Error(`${subject} payload is invalid`)
  }
  return {
    operationId,
    operation,
    status: {
      organizationId: row.organizationId,
      state: requiredString(payload, 'resultState', subject),
      revision: requiredInteger(payload, 'resultRevision', subject),
      closureLineageId: nullableString(payload, 'closureLineageId', subject),
      closureRequestedAt: nullableDate(payload, 'closureRequestedAt', subject),
      recoverableUntil: nullableDate(payload, 'recoverableUntil', subject),
      irreversibleAt: nullableDate(payload, 'irreversibleAt', subject),
      closedAt: nullableDate(payload, 'closedAt', subject),
      reactivationRequired: requiredBoolean(payload, 'reactivationRequired', subject),
      lastTransitionAt: requiredDate(payload, 'lastTransitionAt', subject),
      lastActorId: requiredString(payload, 'lastActorId', subject),
      lastReasonCode: requiredString(payload, 'lastReasonCode', subject),
      lastSupportEvidenceRef: requiredString(payload, 'lastSupportEvidenceRef', subject),
    },
  }
}

export async function appendOrganizationLifecycleCommandEvent(
  tx: Tx,
  event: OrganizationLifecycleCommandEvent,
): Promise<void> {
  await tx.insert(organizationLifecycleEvents).values({
    organizationId: event.status.organizationId,
    context: 'identity',
    phase: 'command',
    kind: commandKind(event.operationId),
    payload: {
      operationId: event.operationId,
      operation: event.operation,
      resultState: event.status.state,
      resultRevision: event.status.revision,
      closureLineageId: event.status.closureLineageId,
      closureRequestedAt: event.status.closureRequestedAt?.toISOString() ?? null,
      recoverableUntil: event.status.recoverableUntil?.toISOString() ?? null,
      irreversibleAt: event.status.irreversibleAt?.toISOString() ?? null,
      closedAt: event.status.closedAt?.toISOString() ?? null,
      reactivationRequired: event.status.reactivationRequired,
      lastTransitionAt: event.status.lastTransitionAt.toISOString(),
      lastActorId: event.status.lastActorId,
      lastReasonCode: event.status.lastReasonCode,
      lastSupportEvidenceRef: event.status.lastSupportEvidenceRef,
    },
    recordedAt: event.status.lastTransitionAt,
  })
}

export type PropertyEraseContextEvent = Readonly<{
  organizationId: string
  authorityId: string
  context: OrganizationLifecycleEventContext
  phase: 'inventory' | 'purge'
  outcome: OrganizationLifecycleReceiptOutcome
  erasedRowCount: number
  evidenceRef: string
  recordedAt: Date
}>

export async function appendPropertyEraseContextEvent(
  tx: Tx,
  event: PropertyEraseContextEvent,
): Promise<void> {
  await tx
    .insert(organizationLifecycleEvents)
    .values({
      organizationId: event.organizationId,
      context: event.context,
      phase: event.phase,
      kind: propertyEraseKind(event.authorityId),
      payload: {
        authorityId: event.authorityId,
        outcome: event.outcome,
        erasedRowCount: event.erasedRowCount,
        evidenceRef: event.evidenceRef,
      },
      recordedAt: event.recordedAt,
    })
    .onConflictDoNothing({
      target: [
        organizationLifecycleEvents.context,
        organizationLifecycleEvents.phase,
        organizationLifecycleEvents.kind,
      ],
    })
}

export async function readPropertyEraseContextEvents(
  tx: Tx,
  input: Readonly<{ authorityId: string; phase: 'inventory' | 'purge' }>,
): Promise<readonly PropertyEraseContextEvent[]> {
  const rows = await tx
    .select({
      organizationId: organizationLifecycleEvents.organizationId,
      context: organizationLifecycleEvents.context,
      payload: organizationLifecycleEvents.payload,
      recordedAt: organizationLifecycleEvents.recordedAt,
    })
    .from(organizationLifecycleEvents)
    .where(
      and(
        eq(organizationLifecycleEvents.phase, input.phase),
        eq(organizationLifecycleEvents.kind, propertyEraseKind(input.authorityId)),
      ),
    )
    .orderBy(organizationLifecycleEvents.context)

  return rows.map((row) => {
    const subject = 'Property erase context event'
    const payload = objectPayload(row.payload, subject)
    const outcome = requiredString(payload, 'outcome', subject)
    if (outcome !== 'complete' && outcome !== 'no_data') {
      throw new Error(`${subject} payload is invalid`)
    }
    return {
      organizationId: row.organizationId,
      authorityId: input.authorityId,
      context: row.context,
      phase: input.phase,
      outcome,
      erasedRowCount: requiredInteger(payload, 'erasedRowCount', subject),
      evidenceRef: requiredString(payload, 'evidenceRef', subject),
      recordedAt: row.recordedAt,
    }
  })
}

export type BackupErasureHoldReleaseEvent = Readonly<{
  ledgerEntryId: string
  holdReference: string
  authorityRef: string
  releasedAt: Date
}>

export async function appendBackupErasureHoldReleaseEvent(
  tx: Tx,
  release: BackupErasureHoldReleaseEvent,
): Promise<void> {
  const ledgers = await tx
    .select({
      organizationId: backupErasureLedger.organizationId,
      context: backupErasureLedger.context,
    })
    .from(backupErasureLedger)
    .where(eq(backupErasureLedger.id, release.ledgerEntryId))
    .limit(1)
  const ledger = ledgers[0]
  if (!ledger) throw new Error('backup erasure ledger entry does not exist')

  await tx
    .insert(organizationLifecycleEvents)
    .values({
      organizationId: ledger.organizationId,
      context: ledger.context,
      phase: 'hold_release',
      kind: backupHoldReleaseKind(release.ledgerEntryId),
      payload: {
        ledgerEntryId: release.ledgerEntryId,
        holdReference: release.holdReference,
        authorityRef: release.authorityRef,
      },
      recordedAt: release.releasedAt,
    })
    .onConflictDoNothing({
      target: [
        organizationLifecycleEvents.context,
        organizationLifecycleEvents.phase,
        organizationLifecycleEvents.kind,
      ],
    })
}

export async function readBackupErasureHoldReleaseEvents(
  tx: Tx,
): Promise<readonly BackupErasureHoldReleaseEvent[]> {
  const rows = await tx
    .select({
      payload: organizationLifecycleEvents.payload,
      releasedAt: organizationLifecycleEvents.recordedAt,
    })
    .from(organizationLifecycleEvents)
    .where(
      and(
        eq(organizationLifecycleEvents.phase, 'hold_release'),
        sql`${organizationLifecycleEvents.kind} LIKE ${`${BACKUP_HOLD_RELEASE_KIND_PREFIX}:%`}`,
      ),
    )

  return rows.map((row) => {
    const subject = 'Backup erasure hold release event'
    const payload = objectPayload(row.payload, subject)
    return {
      ledgerEntryId: requiredString(payload, 'ledgerEntryId', subject),
      holdReference: requiredString(payload, 'holdReference', subject),
      authorityRef: requiredString(payload, 'authorityRef', subject),
      releasedAt: row.releasedAt,
    }
  })
}
