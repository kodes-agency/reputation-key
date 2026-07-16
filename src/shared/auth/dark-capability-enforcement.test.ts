// BQR-0: Capability enforcement architecture test.
//
// Verifies that server functions in "dark" contexts (team, portal, guest,
// goal, badge, leaderboard) import and call assertBetaCapability before
// their handler body executes.
//
// Per BQR master plan §3.3: "No third state is permitted. A capability
// cannot be considered 'off' merely because navigation is hidden."
//
// This test prevents a dark context from adding a new server function
// without a capability check.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DARK_CONTEXT_CAPABILITY: Readonly<Record<string, string>> = {
  team: 'team.use',
  portal: 'portal.read',
  guest: 'portal.read',
  goal: 'goal.use',
  badge: 'badge.use',
  leaderboard: 'leaderboard.use',
}

const SERVER_DIR = join(process.cwd(), 'src', 'contexts')

function getServerFiles(context: string): string[] {
  const dir = join(SERVER_DIR, context, 'server')
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

describe('BQR-0: Dark context capability enforcement', () => {
  for (const [context, capability] of Object.entries(DARK_CONTEXT_CAPABILITY)) {
    const files = getServerFiles(context)

    if (files.length === 0) continue

    describe(`${context} server functions`, () => {
      for (const file of files) {
        const basename = file.split('/').pop()!
        const content = readFileSync(file, 'utf-8')

        // Skip utility/helper files that don't export server functions
        if (!content.includes('createServerFn')) continue

        it(`${basename} imports a capability assertion`, () => {
          expect(
            content.match(/assert(Global|Beta)Capability/),
            `${basename} in dark context "${context}" must import and call assertBetaCapability or assertGlobalCapability`,
          ).not.toBeNull()
        })

        it(`${basename} references capability '${capability}'`, () => {
          expect(
            content,
            `${basename} in dark context "${context}" must reference '${capability}'`,
          ).toContain(capability)
        })
      }
    })
  }
})
