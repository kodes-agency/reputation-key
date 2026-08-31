import { describe, expect, it } from 'vitest'
import { findZodV4ConformanceViolations } from './zod-v4-conformance'

describe('Zod v4 conformance', () => {
  it('rejects the ambiguous package-root import', () => {
    const source = "import { z } from 'zod'"

    expect(findZodV4ConformanceViolations(source)).toEqual([
      expect.objectContaining({ kind: 'mixed-import', line: 1 }),
    ])
  })

  it('rejects legacy re-exports and runtime module loads', () => {
    const source = `
      export { z } from 'zod/v3'
      const runtime = require('zod')
      const lazy = import('zod/v3')
    `

    expect(findZodV4ConformanceViolations(source)).toEqual([
      expect.objectContaining({ kind: 'mixed-import', line: 2 }),
      expect.objectContaining({ kind: 'mixed-import', line: 3 }),
      expect.objectContaining({ kind: 'mixed-import', line: 4 }),
    ])
  })

  it('rejects deprecated string format methods', () => {
    const source = `
      import { z as schema } from 'zod/v4'
      const id = schema.string().uuid()
      const instant = schema.string().datetime({ offset: true })
    `

    expect(findZodV4ConformanceViolations(source)).toEqual([
      expect.objectContaining({ kind: 'deprecated-string-format', line: 3 }),
      expect.objectContaining({ kind: 'deprecated-string-format', line: 4 }),
    ])
  })

  it('accepts explicit v4 imports and current format schemas', () => {
    const source = `
      import { z } from 'zod/v4'
      const id = z.uuid()
      const instant = z.iso.datetime({ offset: true })
    `

    expect(findZodV4ConformanceViolations(source)).toEqual([])
  })

  it('does not treat comments or string literals as code', () => {
    const source = `
      // import { z } from 'zod'
      const migrationNote = "replace z.string().uuid()"
    `

    expect(findZodV4ConformanceViolations(source)).toEqual([])
  })
})
