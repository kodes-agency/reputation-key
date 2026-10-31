import { z } from 'zod/v4'
import type { DraftReportFilter } from '#/shared/db/ai/draft-measurement-report'

/** Report options contain only a timestamp and optional Property identity. */
export function parseDraftsReportArgs(args: readonly string[]): DraftReportFilter {
  const options: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if ((key !== '--since' && key !== '--property') || !value || options[key])
      throw new Error(
        'Usage: pnpm ops ai drafts-report [--since <ISO timestamp>] [--property <UUID>]',
      )
    options[key] = value
  }
  return {
    ...(options['--since']
      ? { since: z.iso.datetime({ offset: true }).parse(options['--since']) }
      : {}),
    ...(options['--property']
      ? { propertyId: z.uuid().parse(options['--property']) }
      : {}),
  }
}

import type { OperatorCommandSpec } from './operator-command'
export const draftsReportCommandSpec: OperatorCommandSpec = Object.freeze({
  name: 'ops:ai:drafts-report',
  scope: 'global',
  mutation: false,
  usage:
    'pnpm ops ai drafts-report --operator <id> [--since <ISO timestamp>] [--property <UUID>]',
})
