import type { BetaFeedbackTriageRepository } from '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'
import type { OperatorArgs, OperatorIO } from '../../src/shared/ops/operator-command'

type FeedbackRecord = NonNullable<
  Awaited<ReturnType<BetaFeedbackTriageRepository['find']>>
>

/** The report the command names, or the exit code after saying why there is none. */
export async function findNamedFeedbackRecord(
  repository: BetaFeedbackTriageRepository,
  args: OperatorArgs,
  io: OperatorIO,
  usage: string,
): Promise<FeedbackRecord | 2> {
  const reference = args.positionals[0]
  if (!reference) {
    io.err(`a feedback reference is required\nusage: ${usage}`)
    return 2
  }
  const record = await repository.find(reference)
  if (!record) {
    io.err(`no beta feedback record for ${reference}`)
    return 2
  }
  return record
}
