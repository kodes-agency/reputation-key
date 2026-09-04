// ops:ai-approve-enrollment — inspect or approve one complete Review Analysis
// first-enablement snapshot that crossed the fixed 10,000-revision safety
// ceiling. This command never creates consent, changes the snapshot, chooses a
// subset, starts a replay, or activates provider execution.

import { createHash, randomUUID } from 'node:crypto'
import { getDb } from '../../src/shared/db'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import { createApproveReviewAnalysisEnrollment } from '../../src/contexts/ai/application/use-cases/approve-review-analysis-enrollment'
import { createReviewAnalysisEnrollmentAdapter } from '../../src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:ai-approve-enrollment'
const USAGE =
  'pnpm ops:ai-approve-enrollment --operator <id> --org <id> --property <uuid> [--reason <text> --ticket <ref> --apply --yes ops:ai-approve-enrollment]'

const approvalEvidenceDigest = (
  input: Readonly<{
    operatorId: string
    organizationId: string
    propertyId: string
    enrollmentId: string
    fence: Readonly<{
      authorizationLineageId: string
      authorizationStateVersion: number
      sourceEpoch: number
      reviewAnalysisEpoch: number
      analysisStartSequence: number
    }>
    ticket: string
  }>,
): string =>
  createHash('sha256')
    .update(
      [
        COMMAND_NAME,
        input.operatorId,
        input.organizationId,
        input.propertyId,
        input.enrollmentId,
        input.fence.authorizationLineageId,
        String(input.fence.authorizationStateVersion),
        String(input.fence.sourceEpoch),
        String(input.fence.reviewAnalysisEpoch),
        String(input.fence.analysisStartSequence),
        input.ticket,
      ].join('\u0000'),
    )
    .digest('hex')

const main = async (): Promise<void> => {
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'property',
      capability: 'ai.analyze',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const db = getDb()
      const enrollments = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
      const scope = {
        organizationId: organizationId(ctx.organizationId as string),
        propertyId: propertyId(ctx.propertyId as string),
      }
      const enrollment = await enrollments.readCurrent(scope)
      if (enrollment === null) {
        io.err(
          JSON.stringify(
            {
              action: 'refused',
              precondition: 'enrollment_not_found',
              organizationId: scope.organizationId,
              propertyId: scope.propertyId,
            },
            null,
            2,
          ),
        )
        return 1
      }

      const report = {
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        enrollmentId: enrollment.id,
        state: enrollment.state,
        snapshotRevisionCount: enrollment.snapshotRevisionCount,
        safetyCeiling: enrollment.safetyCeiling,
        assistedApprovalRequired: enrollment.assistedApprovalRequired,
        assistedApprovalRecorded: enrollment.assistedApproval !== null,
        fence: enrollment.fence,
      }
      if (ctx.dryRun) {
        io.out(
          JSON.stringify(
            {
              action:
                enrollment.state === 'awaiting_assisted_approval'
                  ? 'would_approve_complete_snapshot'
                  : enrollment.assistedApproval !== null
                    ? 'already_approved'
                    : 'approval_not_required',
              ...report,
            },
            null,
            2,
          ),
        )
        return
      }

      const approve = createApproveReviewAnalysisEnrollment({ enrollments })
      const outcome = await approve({
        enrollmentId: enrollment.id,
        organizationId: scope.organizationId,
        expectedFence: enrollment.fence,
        approvedByOperatorId: ctx.operatorId,
        approvalEvidenceDigest: approvalEvidenceDigest({
          operatorId: ctx.operatorId,
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          enrollmentId: enrollment.id,
          fence: enrollment.fence,
          ticket: ctx.ticket as string,
        }),
        correlationId: ctx.correlationId,
        occurredAt: new Date(),
      })
      if (outcome.status === 'refused') {
        io.err(
          JSON.stringify(
            { action: 'refused', precondition: outcome.reason, ...report },
            null,
            2,
          ),
        )
        return 1
      }
      io.out(
        JSON.stringify(
          {
            action: outcome.status === 'duplicate' ? 'already_approved' : 'approved',
            ...report,
            state: 'queued',
          },
          null,
          2,
        ),
      )
    },
    process.argv.slice(2),
  )
  process.exit(result.exitCode)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
  process.exit(1)
})
