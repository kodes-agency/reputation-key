import { reviewId, unbrand } from '#/shared/domain/ids'
import type {
  ReviewSourceContentLifecycleAppliedBatch,
  ReviewSourceContentLifecycleCursor,
  ReviewSourceContentLifecycleMode,
  ReviewSourceContentLifecycleScope,
  ReviewSourceContentLifecycleStore,
  ReviewSourceContentShadowFinding,
} from '../ports/source-content-lifecycle-store.port'
import type { ReviewLifecycleRecoveryExecutionIdentity } from '../ports/lifecycle-recovery-execution-store.port'
import { ReviewDestructiveLifecycleQuarantinedError } from '../review-lifecycle-safety'

export const REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT =
  'review-source-content-lifecycle-v1' as const

/** Exact operator/executor acknowledgement required in addition to approval. */
export const REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION =
  'apply-review-source-content-lifecycle-v1' as const

export const REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE = 100

/** Version stamped by the Review-owned lifecycle store on content-free evidence. */
export const REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION = 5

export type ReviewSourceContentLifecycleApplyApproval = Readonly<{
  /** Human/audit-system approval identifier. It is content-free. */
  approvalId: string
  /** SHA-256 of the immutable reviewed cutover evidence bundle. */
  evidenceSha256: string
  approvedAt: string
}>

export type AuthorizeReviewSourceContentLifecycleApply = (
  input: Readonly<{
    contract: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT
    evaluatedAt: Date
    scope: ReviewSourceContentLifecycleScope
    priorApproval: ReviewSourceContentLifecycleApplyApproval | null
  }>,
) => Promise<ReviewSourceContentLifecycleApplyApproval>

export type ReviewSourceContentLifecycleCheckpoint = Readonly<{
  contract: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT
  mode: ReviewSourceContentLifecycleMode
  scope: ReviewSourceContentLifecycleScope
  evaluatedAt: string
  after: Readonly<{
    createdAt: string
    reviewId: string
  }>
  /** Present only for apply; every continuation revalidates this exact seal. */
  approval?: ReviewSourceContentLifecycleApplyApproval
}>

type LifecycleCounts = Readonly<{
  eligible: number
  expired: number
  tombstone: number
  unverifiable: number
}>

type ShadowSummary = Readonly<{
  matched: number
  drifted: number
  findingCounts: Partial<Record<ReviewSourceContentShadowFinding, number>>
  driftedReviewIds: ReadonlyArray<string>
}>

export type ReviewSourceContentLifecycleResult = Readonly<{
  contract: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT
  mode: ReviewSourceContentLifecycleMode
  scope: ReviewSourceContentLifecycleScope
  evaluatedAt: string
  status: 'complete' | 'checkpointed'
  scanned: number
  lifecycle: LifecycleCounts
  shadow: ShadowSummary | null
  nextCheckpoint: ReviewSourceContentLifecycleCheckpoint | null
  apply:
    | Readonly<{
        enabled: false
        reason: 'external_shadow_parity_and_cutover_approval_required'
      }>
    | Readonly<{
        enabled: true
        approval: ReviewSourceContentLifecycleApplyApproval
        rowsRedacted: number
        legacyGoogleRepliesReconciled: number
      }>
}>

export type RunReviewSourceContentLifecycleDeps = Readonly<{
  store: ReviewSourceContentLifecycleStore
  clock: () => Date
  /**
   * Deliberately absent from the normal composition root. A reviewed cutover
   * process must inject and revalidate this authority for every apply page.
   */
  authorizeApply?: AuthorizeReviewSourceContentLifecycleApply
}>

export type RunReviewSourceContentLifecycleInput = Readonly<{
  mode: ReviewSourceContentLifecycleMode
  batchSize: number
  /** Defaults to the global expired-content lifecycle. */
  scope?: ReviewSourceContentLifecycleScope
  checkpoint?: ReviewSourceContentLifecycleCheckpoint
  /** Required for apply even when a reviewed authorizer is injected. */
  applyConfirmation?: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION
  /** Restore-only receipt whose progress must commit atomically with this page. */
  recoveryExecution?: ReviewLifecycleRecoveryExecutionIdentity
}>

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SUBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u

const DEFAULT_SCOPE = Object.freeze({ kind: 'expired' as const })

function validSubjectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SUBJECT_ID_RE.test(value)) {
    throw new TypeError(`${field} is invalid`)
  }
  return value
}

function normalizedScope(
  value: ReviewSourceContentLifecycleScope | undefined,
): ReviewSourceContentLifecycleScope {
  const scope: ReviewSourceContentLifecycleScope = value ?? DEFAULT_SCOPE
  if (scope == null || typeof scope !== 'object') {
    throw new TypeError('Review lifecycle scope is invalid')
  }
  switch (scope.kind) {
    case 'expired':
      return scope.organizationId == null
        ? DEFAULT_SCOPE
        : {
            kind: 'expired',
            organizationId: validSubjectId(
              scope.organizationId,
              'Review lifecycle Organization ID',
            ) as typeof scope.organizationId,
          }
    case 'connection': {
      const connectionId = validSubjectId(
        scope.connectionId,
        'Review lifecycle connection ID',
      )
      if (!UUID_RE.test(connectionId)) {
        throw new TypeError('Review lifecycle connection ID must be a UUID')
      }
      return {
        kind: 'connection',
        organizationId: validSubjectId(
          scope.organizationId,
          'Review lifecycle Organization ID',
        ) as typeof scope.organizationId,
        connectionId,
      }
    }
    case 'property': {
      const property = validSubjectId(scope.propertyId, 'Review lifecycle Property ID')
      if (!UUID_RE.test(property)) {
        throw new TypeError('Review lifecycle Property ID must be a UUID')
      }
      return {
        kind: 'property',
        organizationId: validSubjectId(
          scope.organizationId,
          'Review lifecycle Organization ID',
        ) as typeof scope.organizationId,
        propertyId: property as typeof scope.propertyId,
      }
    }
    case 'organization':
      return {
        kind: 'organization',
        organizationId: validSubjectId(
          scope.organizationId,
          'Review lifecycle Organization ID',
        ) as typeof scope.organizationId,
      }
    default:
      throw new TypeError('Review lifecycle scope kind is invalid')
  }
}

function sameScope(
  left: ReviewSourceContentLifecycleScope,
  right: ReviewSourceContentLifecycleScope,
): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case 'expired':
      return (
        (left.organizationId == null ? null : String(left.organizationId)) ===
        (right.kind === 'expired' && right.organizationId != null
          ? String(right.organizationId)
          : null)
      )
    case 'connection':
      return (
        right.kind === 'connection' &&
        left.organizationId === right.organizationId &&
        left.connectionId === right.connectionId
      )
    case 'property':
      return (
        right.kind === 'property' &&
        left.organizationId === right.organizationId &&
        left.propertyId === right.propertyId
      )
    case 'organization':
      return right.kind === 'organization' && left.organizationId === right.organizationId
  }
}

function validDate(value: string, field: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${field} must be a canonical ISO timestamp`)
  }
  return parsed
}

function resolveWindow(
  input: RunReviewSourceContentLifecycleInput,
  clock: () => Date,
): Readonly<{
  evaluatedAt: Date
  after: ReviewSourceContentLifecycleCursor | null
  scope: ReviewSourceContentLifecycleScope
}> {
  if (!input.checkpoint) {
    const evaluatedAt = clock()
    if (!Number.isFinite(evaluatedAt.getTime())) {
      throw new TypeError('lifecycle clock returned an invalid timestamp')
    }
    return { evaluatedAt, after: null, scope: normalizedScope(input.scope) }
  }

  const checkpoint = input.checkpoint
  if (checkpoint.contract !== REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT) {
    throw new TypeError('unsupported Review source-content lifecycle checkpoint')
  }
  if (checkpoint.mode !== input.mode) {
    throw new TypeError('checkpoint mode does not match the requested lifecycle mode')
  }
  if (checkpoint.scope == null) {
    throw new TypeError('Review lifecycle checkpoint scope is required')
  }
  const checkpointScope = normalizedScope(checkpoint.scope)
  if (input.scope != null && !sameScope(normalizedScope(input.scope), checkpointScope)) {
    throw new TypeError('checkpoint scope does not match the requested lifecycle scope')
  }
  if (input.mode === 'apply' && checkpoint.approval == null) {
    throw new TypeError('apply checkpoint must carry frozen approval evidence')
  }
  if (input.mode !== 'apply' && checkpoint.approval != null) {
    throw new TypeError('inspection checkpoint cannot carry apply approval evidence')
  }
  if (!UUID_RE.test(checkpoint.after.reviewId)) {
    throw new TypeError('checkpoint Review ID must be a UUID')
  }
  const evaluatedAt = validDate(checkpoint.evaluatedAt, 'checkpoint evaluatedAt')
  const createdAt = validDate(checkpoint.after.createdAt, 'checkpoint createdAt')
  if (createdAt > evaluatedAt) {
    throw new TypeError('checkpoint cursor cannot be newer than its report window')
  }
  return {
    evaluatedAt,
    after: { createdAt, reviewId: reviewId(checkpoint.after.reviewId) },
    scope: checkpointScope,
  }
}

const APPROVAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const SHA256_RE = /^[0-9a-f]{64}$/u

function validateApproval(
  approval: ReviewSourceContentLifecycleApplyApproval,
): ReviewSourceContentLifecycleApplyApproval {
  if (!APPROVAL_ID_RE.test(approval.approvalId)) {
    throw new TypeError('Review lifecycle approval ID is invalid')
  }
  if (!SHA256_RE.test(approval.evidenceSha256)) {
    throw new TypeError('Review lifecycle approval evidence digest is invalid')
  }
  const approvedAt = validDate(approval.approvedAt, 'approval approvedAt')
  return {
    approvalId: approval.approvalId,
    evidenceSha256: approval.evidenceSha256,
    approvedAt: approvedAt.toISOString(),
  }
}

function sameApproval(
  left: ReviewSourceContentLifecycleApplyApproval,
  right: ReviewSourceContentLifecycleApplyApproval,
): boolean {
  return (
    left.approvalId === right.approvalId &&
    left.evidenceSha256 === right.evidenceSha256 &&
    left.approvedAt === right.approvedAt
  )
}

function lifecycleCounts(
  rows: Awaited<ReturnType<ReviewSourceContentLifecycleStore['readInspectionBatch']>>,
  evaluatedAt: Date,
): LifecycleCounts {
  const counts = { eligible: 0, expired: 0, tombstone: 0, unverifiable: 0 }
  for (const row of rows) {
    if (row.sourceContentState !== 'active') counts.tombstone += 1
    else if (row.lifecycleClock == null) counts.unverifiable += 1
    else if (row.lifecycleClock <= evaluatedAt) counts.expired += 1
    else counts.eligible += 1
  }
  return counts
}

function shadowSummary(
  rows: Awaited<ReturnType<ReviewSourceContentLifecycleStore['readInspectionBatch']>>,
): ShadowSummary {
  const findingCounts: Partial<Record<ReviewSourceContentShadowFinding, number>> = {}
  const driftedReviewIds: string[] = []
  let matched = 0
  for (const row of rows) {
    if (row.shadowFindings.length === 0) {
      matched += 1
      continue
    }
    driftedReviewIds.push(unbrand(row.reviewId))
    for (const finding of row.shadowFindings) {
      findingCounts[finding] = (findingCounts[finding] ?? 0) + 1
    }
  }
  return {
    matched,
    drifted: rows.length - matched,
    findingCounts,
    driftedReviewIds,
  }
}

type LifecycleWindow = ReturnType<typeof resolveWindow>
type LifecycleRows = Awaited<
  ReturnType<ReviewSourceContentLifecycleStore['readInspectionBatch']>
>
type LifecyclePage = Readonly<{
  rows: LifecycleRows
  hasMore: boolean
  approval: ReviewSourceContentLifecycleApplyApproval | null
  applied: ReviewSourceContentLifecycleAppliedBatch | null
}>

/**
 * This input is emitted only by trusted job/operator wiring. Invalid values
 * therefore indicate a programmer, configuration, or corrupt checkpoint fault
 * rather than a Review business-rule alternative; the delivery boundary
 * sanitizes the native error.
 */
function assertLifecycleInput(input: RunReviewSourceContentLifecycleInput): void {
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE
  ) {
    throw new TypeError(
      `Review source-content lifecycle batchSize must be between 1 and ${REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE}`,
    )
  }
  if (input.mode !== 'apply' && input.applyConfirmation != null) {
    throw new TypeError('Review lifecycle inspection cannot carry apply confirmation')
  }
  if (input.mode !== 'apply' && input.recoveryExecution != null) {
    throw new TypeError('Review lifecycle inspection cannot carry recovery execution')
  }
}

/** Destructive page: the operator acknowledgement, the injected authorizer, and
 * an approval that still matches the checkpoint's frozen seal are all required
 * before any row is redacted. */
async function runApplyPage(
  deps: RunReviewSourceContentLifecycleDeps,
  input: RunReviewSourceContentLifecycleInput,
  window: LifecycleWindow,
): Promise<LifecyclePage> {
  if (
    input.applyConfirmation !== REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION ||
    deps.authorizeApply == null
  ) {
    throw new ReviewDestructiveLifecycleQuarantinedError()
  }
  const priorApproval =
    input.checkpoint?.approval == null
      ? null
      : validateApproval(input.checkpoint.approval)
  const approval = validateApproval(
    await deps.authorizeApply({
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      evaluatedAt: window.evaluatedAt,
      scope: window.scope,
      priorApproval,
    }),
  )
  if (priorApproval != null && !sameApproval(priorApproval, approval)) {
    throw new TypeError('Review lifecycle approval evidence changed during apply')
  }
  const applied = await deps.store.applyLifecycleBatch({
    ...window,
    limit: input.batchSize,
    ...(input.recoveryExecution == null
      ? {}
      : { recoveryExecution: input.recoveryExecution }),
  })
  if (applied.rows.length > input.batchSize) {
    throw new Error('Review lifecycle store applied an unbounded page')
  }
  return { rows: applied.rows, hasMore: applied.hasMore, approval, applied }
}

/** Read-only page. One extra row is requested so the drain learns whether a
 * continuation exists without a second query. */
async function readInspectionPage(
  store: ReviewSourceContentLifecycleStore,
  batchSize: number,
  window: LifecycleWindow,
): Promise<LifecyclePage> {
  const loaded = await store.readInspectionBatch({ ...window, limit: batchSize + 1 })
  if (loaded.length > batchSize + 1) {
    throw new Error('Review lifecycle store returned an unbounded page')
  }
  return {
    rows: loaded.slice(0, batchSize),
    hasMore: loaded.length > batchSize,
    approval: null,
    applied: null,
  }
}

/** Continuation cursor for the next page of the same frozen window; null once
 * the drain is complete. An apply continuation re-carries its approval seal. */
function buildNextCheckpoint(
  input: RunReviewSourceContentLifecycleInput,
  window: LifecycleWindow,
  page: LifecyclePage,
): ReviewSourceContentLifecycleCheckpoint | null {
  const last = page.rows.at(-1)
  if (!page.hasMore || !last) return null
  return {
    contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
    mode: input.mode,
    scope: window.scope,
    evaluatedAt: window.evaluatedAt.toISOString(),
    after: {
      createdAt: last.createdAt.toISOString(),
      reviewId: unbrand(last.reviewId),
    },
    ...(page.approval == null ? {} : { approval: page.approval }),
  }
}

export const createRunReviewSourceContentLifecycle = (
  deps: RunReviewSourceContentLifecycleDeps,
) =>
  async function runReviewSourceContentLifecycle(
    input: RunReviewSourceContentLifecycleInput,
  ): Promise<ReviewSourceContentLifecycleResult> {
    assertLifecycleInput(input)
    const window = resolveWindow(input, deps.clock)
    const page =
      input.mode === 'apply'
        ? await runApplyPage(deps, input, window)
        : await readInspectionPage(deps.store, input.batchSize, window)
    const { rows, approval, applied } = page
    const nextCheckpoint = buildNextCheckpoint(input, window, page)

    return {
      contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
      mode: input.mode,
      scope: window.scope,
      evaluatedAt: window.evaluatedAt.toISOString(),
      status: nextCheckpoint ? 'checkpointed' : 'complete',
      scanned: rows.length,
      lifecycle: lifecycleCounts(rows, window.evaluatedAt),
      shadow:
        input.mode === 'shadow' || input.mode === 'apply' ? shadowSummary(rows) : null,
      nextCheckpoint,
      apply:
        approval == null || applied == null
          ? {
              enabled: false,
              reason: 'external_shadow_parity_and_cutover_approval_required',
            }
          : {
              enabled: true,
              approval,
              rowsRedacted: applied.rowsRedacted,
              legacyGoogleRepliesReconciled: applied.legacyGoogleRepliesReconciled,
            },
    }
  }

export type RunReviewSourceContentLifecycle = ReturnType<
  typeof createRunReviewSourceContentLifecycle
>
