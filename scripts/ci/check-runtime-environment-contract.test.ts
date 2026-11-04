import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { missingExampleKeys } from './check-runtime-environment-contract'

const schema = `
  const unrelated = { NOT_AN_ENV_KEY: true }
  const baseEnvSchema = z.object({
    REQUIRED_KEY: z.string(),
    OPTIONAL_KEY: z.string().optional(),
    DEFAULTED_KEY: z.string().default('value'),
  })
`

const example = `
REQUIRED_KEY=example
# OPTIONAL_KEY=
DEFAULTED_KEY=value
`

describe('environment example keys', () => {
  it('accepts active and commented assignments, including empty optional values', () => {
    expect(missingExampleKeys(schema, example)).toEqual([])
  })

  it('reports a missing key even when it has a default or is mentioned in prose', () => {
    expect(
      missingExampleKeys(
        schema,
        'REQUIRED_KEY=example\n# OPTIONAL_KEY=\n# DEFAULTED_KEY is optional',
      ),
    ).toEqual(['DEFAULTED_KEY'])
  })

  it('reports a newly added schema key', () => {
    const changed = schema.replace('REQUIRED_KEY:', 'NEW_KEY: z.string(), REQUIRED_KEY:')
    expect(missingExampleKeys(changed, example)).toEqual(['NEW_KEY'])
  })

  it('ignores values, comments, ordering and extra example keys', () => {
    expect(
      missingExampleKeys(
        schema,
        '# explanation\nEXTRA_KEY=extra\nDEFAULTED_KEY=other\n# OPTIONAL_KEY=other\nREQUIRED_KEY=other',
      ),
    ).toEqual([])
  })

  it('refuses to pass when it cannot find the schema', () => {
    expect(() => missingExampleKeys('const other = {}', example)).toThrow('baseEnvSchema')
  })

  it('documents every current environment schema key', () => {
    const source = readFileSync(
      new URL('../../src/shared/config/env.ts', import.meta.url),
      'utf8',
    )
    const current = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    expect(missingExampleKeys(source, current)).toEqual([])
  })
})
