import { getDb } from '../../src/shared/db'
import { readDraftMeasurementReport } from '../../src/shared/db/ai/draft-measurement-report'
import {
  parseDraftsReportArgs,
  draftsReportCommandSpec,
} from '../../src/shared/ops/ai-drafts-report-command'
import { runOperatorCommand } from './operator-command'

async function main() {
  const argv = process.argv.slice(2)
  const sinceIndex = argv.indexOf('--since')
  const filter = parseDraftsReportArgs(sinceIndex < 0 ? [] : argv.splice(sinceIndex, 2))
  const result = await runOperatorCommand(
    draftsReportCommandSpec,
    async (_ctx, args, io) => {
      if (args.positionals.length !== 1 || args.positionals[0] !== 'drafts-report')
        return 1
      const property = parseDraftsReportArgs(
        args.propertyId ? ['--property', args.propertyId] : [],
      )
      io.out(
        JSON.stringify(
          await readDraftMeasurementReport(getDb(), { ...filter, ...property }),
          null,
          2,
        ),
      )
    },
    argv,
  )
  process.exitCode = result.exitCode
}
main().catch(() => {
  console.error('Draft report failed. Check arguments and database access.')
  process.exitCode = 1
})
