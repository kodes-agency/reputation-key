// Read-only inventory for QR/NFC addresses created before Qualified Scan
// markers. Exact observation time makes unchanged reruns byte-for-byte stable.
//
// Usage:
//   pnpm ops:report-portal-artifacts --operator <id> --as-of <ISO-8601>
//     [--org <id> ...]

import { getDb } from '../../src/shared/db'
import { createPortalTokenRepository } from '../../src/contexts/portal/infrastructure/repositories/portal-token.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-portal-artifacts'
const USAGE =
  'pnpm ops:report-portal-artifacts --operator <id> --as-of <ISO-8601> [--org <id> ...]'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index < 0 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function withoutAsOf(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--as-of') {
      index += 1
      continue
    }
    if (!token.startsWith('--as-of=')) kept.push(token)
  }
  return kept
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const rawAsOf = flagValue(argv, '--as-of')
  const asOf = rawAsOf ? new Date(rawAsOf) : null
  if (!asOf || Number.isNaN(asOf.getTime())) {
    console.error(`--as-of must be a valid ISO-8601 value\nusage: ${USAGE}`)
    process.exit(2)
  }

  const result = await runOperatorCommand(
    { name: COMMAND_NAME, scope: 'global', mutation: false, usage: USAGE },
    async (_ctx, args, io) => {
      const gaps = await createPortalTokenRepository(
        getDb(),
      ).listAccessArtifactReadinessGaps(
        asOf,
        args.organizations.length > 0 ? args.organizations : undefined,
      )
      io.out(
        JSON.stringify(
          {
            version: 'portal-access-artifact-readiness-v1',
            evaluatedAt: asOf.toISOString(),
            ready: gaps.length === 0,
            gapCount: gaps.length,
            gaps: gaps.map((gap) => ({
              ...gap,
              issuedAt: gap.issuedAt.toISOString(),
              gracePeriodEnds: gap.gracePeriodEnds?.toISOString() ?? null,
              disposition: 'rotate_and_replace_printed_artifact',
            })),
          },
          null,
          2,
        ),
      )
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
