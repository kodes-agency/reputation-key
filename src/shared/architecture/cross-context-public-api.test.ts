// BQC-5.1: Cross-context public-api architecture test.
//
// src/contexts/CONTEXT.md "Dependency rules":
//   "Cross-context: import from the area's public-api.ts only. Never from
//    domain/, infrastructure/, server/, or non-public-api application/."
//   "Exception: Cross-context adapter implementations ... may import the port
//    they implement. The port IS the public interface for adapter contracts."
//
// Drives the real eslint.config.js through the programmatic ESLint API, so the
// test covers both the local rule (`local/cross-context-public-api`) and its
// registration for src/contexts/**.

import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

const RULE_ID = 'local/cross-context-public-api'

const eslint = new ESLint()

async function lintSnippet(code: string, importerRelPath: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), importerRelPath),
  })
  return result.messages
}

const hitsRule = (messages: Array<{ ruleId: string | null }>): boolean =>
  messages.some((m) => m.ruleId === RULE_ID)

describe('BQC-5.1: cross-context public-api rule', () => {
  it('flags application → foreign domain', async () => {
    const messages = await lintSnippet(
      `import { assertRegionResolved } from '#/contexts/property/domain/processing-routing'\nexport const gate = assertRegionResolved\n`,
      'src/contexts/ai/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags application → foreign non-public-api application', async () => {
    // @proof ARCHITECTURE_BOUNDARY_IMPORTS#2
    const messages = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/integration/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows application → foreign public-api', async () => {
    const messages = await lintSnippet(
      `import type { StaffPublicApi } from '#/contexts/identity/public-api'\nexport type { StaffPublicApi }\n`,
      'src/contexts/portal/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  // The public API sits at the area's root. Path math only: the target need
  // not exist.
  it('flags the retired application/public-api of an area that moved', async () => {
    const messages = await lintSnippet(
      `import type { PropertyPublicApi } from '#/contexts/property/application/public-api'\nexport type { PropertyPublicApi }\n`,
      'src/contexts/portal/editor/sample.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows a relative import of a foreign root public-api', async () => {
    const messages = await lintSnippet(
      `import type { PropertyPublicApi } from '../../property/public-api'\nexport type { PropertyPublicApi }\n`,
      'src/contexts/portal/editor/sample.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it.each([
    '#/contexts/property/lifecycle/public-api',
    '#/contexts/property/domain/public-api',
    '#/contexts/identity/staff/people-public-api.server',
    '#/contexts/portal/groups/portal-group-public-api.server',
  ])('flags %s, which is not the area public API', async (source) => {
    const messages = await lintSnippet(
      `import '${source}'\n`,
      'src/contexts/integration/imports/sample.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows infrastructure/adapters → foreign application/ports (adapter exception)', async () => {
    const messages = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/integration/infrastructure/adapters/sample.adapter.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags infrastructure outside adapters/ → foreign application/ports', async () => {
    const messages = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/integration/infrastructure/repositories/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows a feature adapter → foreign application/ports (adapter exception)', async () => {
    const messages = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/integration/imports/sample.adapter.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags a feature server file that is not an adapter → foreign application/ports', async () => {
    const messages = await lintSnippet(
      `import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'\nexport type { OrganizationExportContributor }\n`,
      'src/contexts/integration/imports/sample.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags a feature adapter → foreign infrastructure', async () => {
    const messages = await lintSnippet(
      `import '#/contexts/identity/infrastructure/sample'\n`,
      'src/contexts/integration/imports/sample.adapter.server.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags infrastructure → foreign infrastructure', async () => {
    const messages = await lintSnippet(
      `import { BetaFeedbackTriageRepository } from '#/contexts/identity/infrastructure/beta-feedback-triage.repository'\nexport const factory = BetaFeedbackTriageRepository\n`,
      'src/contexts/property/infrastructure/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows context build.ts → foreign public-api', async () => {
    const messages = await lintSnippet(
      `import type { PropertyPublicApi } from '#/contexts/property/public-api'\nexport type { PropertyPublicApi }\n`,
      'src/contexts/integration/build.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags context build.ts → foreign infrastructure', async () => {
    // @proof ARCHITECTURE_BOUNDARY_IMPORTS#1
    const messages = await lintSnippet(
      `import { BetaFeedbackTriageRepository } from '#/contexts/identity/infrastructure/beta-feedback-triage.repository'\nexport const factory = BetaFeedbackTriageRepository\n`,
      'src/contexts/integration/build.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags relative imports crossing into a foreign context domain', async () => {
    const messages = await lintSnippet(
      `import { assertRegionResolved } from '../../property/domain/processing-routing'\nexport const gate = assertRegionResolved\n`,
      'src/contexts/ai/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows same-context imports', async () => {
    const messages = await lintSnippet(
      `import { aiError } from '../../domain/errors'\nimport type { AiControl } from '../ports/ai-control.port'\nexport const make = (_control: AiControl) => aiError\n`,
      'src/contexts/ai/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags re-exports from a foreign context domain', async () => {
    const messages = await lintSnippet(
      `export { isPortalError } from '#/contexts/portal/domain/errors'\n`,
      'src/contexts/guest/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags dynamic imports of foreign context infrastructure', async () => {
    // @proof ARCHITECTURE_BOUNDARY_IMPORTS#3
    const messages = await lintSnippet(
      `export async function load() {\n  return import('#/contexts/identity/infrastructure/beta-feedback-triage.repository')\n}\n`,
      'src/contexts/property/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags inline import types of a foreign context domain', async () => {
    const messages = await lintSnippet(
      `export type Gate = import('#/contexts/property/domain/processing-routing').ProcessingRouting\n`,
      'src/contexts/ai/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags relative inline import types crossing into a foreign context', async () => {
    const messages = await lintSnippet(
      `export type Gate = import('../../property/domain/processing-routing').ProcessingRouting\n`,
      'src/contexts/ai/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags typeof inline imports of foreign context infrastructure', async () => {
    const messages = await lintSnippet(
      `export type Purge = typeof import('#/contexts/identity/infrastructure/beta-feedback-triage.repository')\n`,
      'src/contexts/property/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows inline import types of a foreign public-api', async () => {
    const messages = await lintSnippet(
      `export type IsActive = import('#/contexts/property/public-api').PropertyLifecyclePublicApi['isPropertyActive']\n`,
      'src/contexts/portal/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })
  describe('browser surface', () => {
    const screen = 'src/contexts/property/setup/ui/sample.tsx'

    it('allows a ui screen → type-only foreign server imports', async () => {
      const messages = await lintSnippet(
        `import type { listPortals } from '#/contexts/portal/server/portals'\nexport type Shape = typeof listPortals\n`,
        screen,
      )
      expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
    })

    it('allows a named contract file → type-only foreign server imports', async () => {
      const messages = await lintSnippet(
        `import type { listPortals } from '#/contexts/portal/server/portals'\nexport type Shape = typeof listPortals\n`,
        'src/contexts/property/setup/setup-plan.contracts.ts',
      )
      expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
    })

    it('flags a ui screen taking a foreign server value', async () => {
      const messages = await lintSnippet(
        `import { listPortals } from '#/contexts/portal/server/portals'\nexport const read = listPortals\n`,
        screen,
      )
      expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
    })

    it('flags a ui screen → foreign ui, dto and application even for types', async () => {
      const messages = await lintSnippet(
        `import type { Wizard } from '#/contexts/reporting/rating-goals/ui/rating-goal-wizard'\nimport type { Notice } from '#/contexts/identity/consent/merchant-ai-notice.contracts'\nexport type Shapes = [Wizard, Notice]\n`,
        screen,
      )
      expect(
        messages.filter((m) => m.ruleId === 'local/cross-context-public-api'),
      ).toHaveLength(2)
    })

    it('flags a non-ui file → foreign server types', async () => {
      const messages = await lintSnippet(
        `import type { listPortals } from '#/contexts/portal/server/portals'\nexport type Shape = typeof listPortals\n`,
        'src/contexts/property/application/use-cases/sample.ts',
      )
      expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
    })
  })
})
