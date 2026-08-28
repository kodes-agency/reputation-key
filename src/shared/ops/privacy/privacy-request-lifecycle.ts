// LIF-01-T20 — running a privacy request from receipt to fulfilment.
//
// The ordering rule that matters most is in `fulfilPrivacyRequest`: a
// withdrawal or a correction must reach the anonymous lifetime aggregate
// BEFORE the source facts are purged. This is the same gate the Guest
// Organization lifecycle contributor enforces at closure
// (`verifyPurgeReadiness`), and the reason is identical: once the source fact
// is gone, the correction that would have fixed the aggregate no longer
// exists, and the aggregate silently keeps a wrong count forever.
//
// Everything here is content-free at the record level. The access package
// carries the subject's own data — that is its purpose — but the REQUEST row,
// the audit rows and the evidence references never do.

import {
  PRIVACY_REQUEST_KIND_OPERATIONS,
  type PrivacyPackageSection,
  type PrivacySubjectContributor,
  type PrivacySubjectScope,
} from './privacy-subject-contributor.port'
import {
  assertContentFreePrivacySubject,
  assertValidPrivacyRequestTransition,
  privacyRequestError,
  type PrivacyRefusalReasonCode,
  type PrivacyRequestKind,
  type PrivacyRequestState,
  type PrivacySubjectType,
} from './privacy-request'
import type { BackupErasureLedgerAppend } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'

export type PrivacyRequestRecord = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  subjectType: PrivacySubjectType
  subjectRef: string
  requestKind: PrivacyRequestKind
  state: PrivacyRequestState
  targetField?: string
  receivedAt: Date
}>

export type PrivacyAuditRow = Readonly<{
  organizationId: string
  action: 'privacy_request.received' | 'privacy_request.fulfilled'
  resourceType: 'privacy_request'
  resourceId: string
  occurredAt: Date
}>

export type PrivacyRequestStore = Readonly<{
  create(
    input: Readonly<{
      organizationId: string
      propertyId: string
      subjectType: PrivacySubjectType
      subjectRef: string
      requestKind: PrivacyRequestKind
      targetField?: string
      evidenceRef: string
      correlationId: string
      receivedAt: Date
    }>,
  ): Promise<PrivacyRequestRecord>
  load(requestId: string): Promise<PrivacyRequestRecord | null>
  transition(
    input: Readonly<{
      requestId: string
      from: PrivacyRequestState
      to: PrivacyRequestState
      verificationRef?: string
      refusalReasonCode?: PrivacyRefusalReasonCode
      packageRef?: string
      packageExpiresAt?: Date
      contentClassification?: 'content_free' | 'personal' | 'sensitive'
      actorType: 'subject' | 'operator' | 'system'
      actorRef: string
      evidenceRef: string
      occurredAt: Date
    }>,
  ): Promise<PrivacyRequestRecord>
  appendAudit(row: PrivacyAuditRow): Promise<void>
}>

export type PrivacyRequestLifecycleDeps = Readonly<{
  store: PrivacyRequestStore
  contributors: readonly PrivacySubjectContributor[]
  runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  /** Delivers corrections/withdrawals to the anonymous lifetime aggregate. */
  deliverAggregateCorrections(
    tx: Tx,
    scope: PrivacySubjectScope,
  ): Promise<Readonly<{ delivered: number; undelivered: number }>>
  appendLedgerEntry(tx: Tx, entry: BackupErasureLedgerAppend): Promise<string>
  /** How long an access package may be retrievable. */
  packageTtlMs: number
  dataCellId: 'us' | 'europe' | 'global'
  now: () => Date
}>

const scopeOf = (record: PrivacyRequestRecord): PrivacySubjectScope => ({
  organizationId: record.organizationId,
  propertyId: record.propertyId,
  subjectType: record.subjectType,
  subjectRef: record.subjectRef,
})

/**
 * Receive a request. Nothing is looked up yet — the subject is not verified.
 *
 * Writes the `privacy_request.received` audit row, which has been declared and
 * unused since the audit action catalogue was written.
 */
export async function receivePrivacyRequest(
  deps: PrivacyRequestLifecycleDeps,
  input: Readonly<{
    organizationId: string
    propertyId: string
    subjectType: PrivacySubjectType
    subjectRef: string
    requestKind: PrivacyRequestKind
    targetField?: string
    correlationId: string
  }>,
): Promise<PrivacyRequestRecord> {
  assertContentFreePrivacySubject(input.subjectRef, input.targetField)
  const now = deps.now()
  const record = await deps.store.create({
    ...input,
    evidenceRef: `privacy:received:${input.requestKind}:${input.correlationId}`,
    receivedAt: now,
  })
  await deps.store.appendAudit({
    organizationId: record.organizationId,
    action: 'privacy_request.received',
    resourceType: 'privacy_request',
    // The request id, not the subject. The audit row must not identify a person.
    resourceId: record.id,
    occurredAt: now,
  })
  return record
}

/**
 * Verify the subject, and only then bind the request to a real subject.
 *
 * Resolution must succeed in EVERY contributor's own scope. A contributor that
 * cannot see this subject in this tenant and Property refuses the request
 * outright rather than contributing nothing, because "nothing" and "not yours"
 * are the same shape in an empty package.
 */
export async function verifyPrivacyRequest(
  deps: PrivacyRequestLifecycleDeps,
  input: Readonly<{ requestId: string; verificationRef: string; actorRef: string }>,
): Promise<PrivacyRequestRecord> {
  const record = await loadRecord(deps, input.requestId)
  assertValidPrivacyRequestTransition(record.state, 'verified')
  const scope = scopeOf(record)

  const resolved = await deps.runInTransaction(async (tx) => {
    const answers = await Promise.all(
      deps.contributors.map((contributor) => contributor.resolve(tx, scope)),
    )
    return answers.some(Boolean)
  })
  if (!resolved) {
    return refusePrivacyRequest(deps, {
      requestId: record.id,
      reasonCode: 'subject_not_found',
      actorRef: input.actorRef,
    })
  }

  return deps.store.transition({
    requestId: record.id,
    from: record.state,
    to: 'verified',
    verificationRef: input.verificationRef,
    actorType: 'operator',
    actorRef: input.actorRef,
    evidenceRef: `privacy:verified:${record.id}`,
    occurredAt: deps.now(),
  })
}

export type PrivacyAccessPackage = Readonly<{
  requestId: string
  organizationId: string
  propertyId: string
  sections: readonly PrivacyPackageSection[]
  classification: 'content_free' | 'personal' | 'sensitive'
  expiresAt: Date
  packageRef: string
}>

export type FulfilPrivacyRequestResult = Readonly<{
  record: PrivacyRequestRecord
  package?: PrivacyAccessPackage
  affected: number
  ledgerEntryId?: string
}>

/**
 * Do the work and fulfil.
 *
 * The order for withdrawal, correction and erasure is fixed and load-bearing:
 *   1. apply the contributor operation;
 *   2. deliver the resulting corrections to the anonymous lifetime aggregate;
 *   3. only THEN purge source facts and append the backup-erasure ledger entry.
 *
 * Step 2 failing leaves the request `in_progress` and the source facts intact.
 * That is the right failure: a retryable stall beats a permanently wrong
 * aggregate with no fact left to fix it.
 */
export async function fulfilPrivacyRequest(
  deps: PrivacyRequestLifecycleDeps,
  input: Readonly<{ requestId: string; actorRef: string; correctionValue?: unknown }>,
): Promise<FulfilPrivacyRequestResult> {
  const verified = await loadRecord(deps, input.requestId)
  assertValidPrivacyRequestTransition(verified.state, 'in_progress')
  const started = await deps.store.transition({
    requestId: verified.id,
    from: verified.state,
    to: 'in_progress',
    actorType: 'operator',
    actorRef: input.actorRef,
    evidenceRef: `privacy:started:${verified.id}`,
    occurredAt: deps.now(),
  })

  const scope = scopeOf(started)
  const operation = PRIVACY_REQUEST_KIND_OPERATIONS[started.requestKind]

  const outcome = await deps.runInTransaction(async (tx) => {
    if (operation === 'access') {
      const sections = (
        await Promise.all(
          deps.contributors.map((contributor) => contributor.access(tx, scope)),
        )
      ).flat()
      return { sections, affected: 0, ledgerEntryId: undefined as string | undefined }
    }

    let affected = 0
    for (const contributor of deps.contributors) {
      if (operation === 'correct') {
        if (started.targetField === undefined) {
          throw privacyRequestError(
            'subject_content_in_record',
            'A correction must name exactly one field',
          )
        }
        affected += (
          await contributor.correct(tx, {
            scope,
            field: started.targetField,
            value: input.correctionValue,
          })
        ).affected
      } else if (operation === 'withdraw') {
        affected += (await contributor.withdraw(tx, scope)).affected
      } else {
        affected += (await contributor.erase(tx, scope)).affected
      }
    }

    // The ordering gate. Corrections and withdrawals must land in the anonymous
    // lifetime aggregate before the source facts they describe are purged.
    const delivery = await deps.deliverAggregateCorrections(tx, scope)
    if (delivery.undelivered > 0) {
      throw privacyRequestError(
        'correction_not_delivered',
        'Privacy fulfilment blocked: corrections have not reached the anonymous lifetime aggregate',
        { undelivered: delivery.undelivered },
      )
    }

    const ledgerEntryId =
      operation === 'erase'
        ? await deps.appendLedgerEntry(tx, {
            subjectClass: 'privacy_subject',
            organizationId: scope.organizationId,
            propertyId: scope.propertyId,
            subjectRef: scope.subjectRef,
            context: scope.subjectType === 'guest' ? 'guest' : 'staff',
            closureLineageId: started.id,
            lifecycleRevision: 1,
            effectiveErasureAt: deps.now(),
            erasedRowCount: affected,
            evidenceRef: `privacy:erasure:${started.id}`,
            dataCellId: deps.dataCellId,
          })
        : undefined

    return { sections: [] as readonly PrivacyPackageSection[], affected, ledgerEntryId }
  })

  const now = deps.now()
  const accessPackage =
    started.requestKind === 'access'
      ? buildAccessPackage(started, outcome.sections, now, deps.packageTtlMs)
      : undefined

  const record = await deps.store.transition({
    requestId: started.id,
    from: 'in_progress',
    to: 'fulfilled',
    ...(accessPackage
      ? {
          packageRef: accessPackage.packageRef,
          packageExpiresAt: accessPackage.expiresAt,
          contentClassification: accessPackage.classification,
        }
      : {}),
    actorType: 'operator',
    actorRef: input.actorRef,
    evidenceRef: `privacy:fulfilled:${started.id}`,
    occurredAt: now,
  })

  await deps.store.appendAudit({
    organizationId: record.organizationId,
    action: 'privacy_request.fulfilled',
    resourceType: 'privacy_request',
    resourceId: record.id,
    occurredAt: now,
  })

  return {
    record,
    ...(accessPackage ? { package: accessPackage } : {}),
    affected: outcome.affected,
    ...(outcome.ledgerEntryId ? { ledgerEntryId: outcome.ledgerEntryId } : {}),
  }
}

export async function refusePrivacyRequest(
  deps: PrivacyRequestLifecycleDeps,
  input: Readonly<{
    requestId: string
    reasonCode: PrivacyRefusalReasonCode
    actorRef: string
  }>,
): Promise<PrivacyRequestRecord> {
  const record = await loadRecord(deps, input.requestId)
  assertValidPrivacyRequestTransition(record.state, 'refused', input.reasonCode)
  return deps.store.transition({
    requestId: record.id,
    from: record.state,
    to: 'refused',
    refusalReasonCode: input.reasonCode,
    actorType: 'operator',
    actorRef: input.actorRef,
    evidenceRef: `privacy:refused:${input.reasonCode}:${record.id}`,
    occurredAt: deps.now(),
  })
}

/**
 * The package is expiry-bound and classified by its most sensitive section.
 *
 * An access export that never expires is a permanent second copy of exactly the
 * data the subject was worried about.
 */
function buildAccessPackage(
  record: PrivacyRequestRecord,
  sections: readonly PrivacyPackageSection[],
  now: Date,
  ttlMs: number,
): PrivacyAccessPackage {
  if (ttlMs <= 0) {
    throw privacyRequestError(
      'package_not_expiry_bound',
      'An access package must carry a positive time to live',
    )
  }
  const classification = sections.some((s) => s.classification === 'sensitive')
    ? 'sensitive'
    : sections.some((s) => s.classification === 'personal')
      ? 'personal'
      : 'content_free'
  return {
    requestId: record.id,
    organizationId: record.organizationId,
    propertyId: record.propertyId,
    sections,
    classification,
    expiresAt: new Date(now.getTime() + ttlMs),
    packageRef: `privacy:package:${record.id}`,
  }
}

async function loadRecord(
  deps: PrivacyRequestLifecycleDeps,
  requestId: string,
): Promise<PrivacyRequestRecord> {
  const record = await deps.store.load(requestId)
  if (!record) {
    throw privacyRequestError('request_not_found', 'Privacy request not found')
  }
  return record
}
