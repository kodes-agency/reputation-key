// BQC-5.1: Cross-context public-api architecture test.
//
// src/contexts/CONTEXT.md "Dependency rules":
//   "Cross-context: import from application/public-api.ts only. Never from
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
      'src/contexts/review/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags application → foreign non-public-api application', async () => {
    const messages = await lintSnippet(
      `import type { SourceContentPurge } from '#/contexts/review/application/ports/source-content-purge.port'\nexport type { SourceContentPurge }\n`,
      'src/contexts/integration/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows application → foreign application/public-api', async () => {
    const messages = await lintSnippet(
      `import type { StaffPublicApi } from '#/contexts/staff/application/public-api'\nexport type { StaffPublicApi }\n`,
      'src/contexts/portal/application/use-cases/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('allows infrastructure/event-handlers → foreign public-api', async () => {
    const messages = await lintSnippet(
      `import { isRegionProcessable } from '#/contexts/property/application/public-api'\nexport const gate = isRegionProcessable\n`,
      'src/contexts/review/infrastructure/event-handlers/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('allows infrastructure/adapters → foreign application/ports (adapter exception)', async () => {
    const messages = await lintSnippet(
      `import type { AccessiblePropertyLookupPort } from '#/contexts/staff/application/ports/accessible-property-lookup.port'\nexport type { AccessiblePropertyLookupPort }\n`,
      'src/contexts/identity/infrastructure/adapters/sample.adapter.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags infrastructure outside adapters/ → foreign application/ports', async () => {
    const messages = await lintSnippet(
      `import type { AccessiblePropertyLookupPort } from '#/contexts/staff/application/ports/accessible-property-lookup.port'\nexport type { AccessiblePropertyLookupPort }\n`,
      'src/contexts/identity/infrastructure/repositories/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('flags infrastructure → foreign infrastructure', async () => {
    const messages = await lintSnippet(
      `import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'\nexport const factory = createSourceContentPurge\n`,
      'src/contexts/property/infrastructure/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows context build.ts → foreign public-api', async () => {
    const messages = await lintSnippet(
      `import type { PropertyPublicApi } from '#/contexts/property/application/public-api'\nexport type { PropertyPublicApi }\n`,
      'src/contexts/integration/build.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(false)
  })

  it('flags relative imports crossing into a foreign context domain', async () => {
    const messages = await lintSnippet(
      `import { assertRegionResolved } from '../../property/domain/processing-routing'\nexport const gate = assertRegionResolved\n`,
      'src/contexts/review/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })

  it('allows same-context imports', async () => {
    const messages = await lintSnippet(
      `import { reviewError } from '../../domain/errors'\nimport type { ReviewRepository } from '../ports/review.repository'\nexport const make = (_repo: ReviewRepository) => reviewError\n`,
      'src/contexts/review/application/use-cases/sample.ts',
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
    const messages = await lintSnippet(
      `export async function load() {\n  return import('#/contexts/review/infrastructure/source-content-purge')\n}\n`,
      'src/contexts/property/application/sample.ts',
    )
    expect(hitsRule(messages), JSON.stringify(messages)).toBe(true)
  })
})
