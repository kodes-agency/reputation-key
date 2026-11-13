// Render one report's consented masked layout to a local SVG file.
//
// The geometry never leaves this deployment: it is not in monitoring and not on
// the issue tracker, so this is how a triager looks at it. The SVG is BUILT
// from validated integers by `renderMaskedLayoutSvg`; nothing is parsed back,
// and the file carries no text, image or link element.
//
// A layout that has passed its 30-day horizon is simply gone — the retention
// sweep deletes on `expires_at` — and this reports that rather than resurrecting
// anything.
//
//   pnpm ops feedback-layout <reference> [out.svg] --operator <id>

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb } from '../../src/shared/db'
import { BetaFeedbackTriageRepository } from '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'
import {
  renderMaskedLayoutSvg,
  summarizeMaskedLayout,
} from '../../src/shared/beta-feedback-layout'
import { runCommandEntrypoint } from './command-entrypoint'
import { runDatabaseOperatorCommand } from './operator-command'
import { findNamedFeedbackRecord } from './feedback-record'

const COMMAND = 'ops:feedback-layout'
const USAGE = `pnpm ops feedback-layout <reference> [out.svg] --operator <id>`

async function main(): Promise<void> {
  const result = await runDatabaseOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      // A read: it renders what is already stored and changes nothing.
      mutation: false,
      requiresTicket: false,
      usage: USAGE,
    },
    async (_context, args, io) => {
      const repository = BetaFeedbackTriageRepository.create(getDb())
      const record = await findNamedFeedbackRecord(repository, args, io, USAGE)
      if (record === 2) return 2
      const { reference } = record
      if (record.attachmentKind !== 'masked_layout_v1') {
        io.err(`${reference} carries no masked layout`)
        return 2
      }

      const layout = await repository.findMaskedLayout(reference)
      if (!layout) {
        io.out(
          JSON.stringify(
            {
              command: COMMAND,
              reference,
              outcome: 'expired',
              expiresAt: record.attachmentExpiresAt?.toISOString() ?? null,
              note: 'The retention sweep has already deleted this layout.',
            },
            null,
            2,
          ),
        )
        return
      }

      const outPath = resolve(args.positionals[1] ?? `${reference}.svg`)
      writeFileSync(outPath, renderMaskedLayoutSvg(layout), 'utf8')

      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            reference,
            outcome: 'rendered',
            file: outPath,
            shape: summarizeMaskedLayout(layout),
            expiresAt: record.attachmentExpiresAt?.toISOString() ?? null,
          },
          null,
          2,
        ),
      )
    },
  )
  process.exit(result.exitCode)
}

void runCommandEntrypoint(COMMAND, main)
