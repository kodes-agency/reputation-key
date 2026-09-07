import { ESLint } from 'eslint'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RULE_ID = 'local/zod-v4'
const eslint = new ESLint()

async function ruleMessages(code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), 'src/shared/architecture/zod-v4-fixture.ts'),
  })
  return result.messages.filter(({ ruleId }) => ruleId === RULE_ID)
}

describe('Zod v4 ESLint rule', () => {
  it('rejects the ambiguous package-root import', async () => {
    const messages = await ruleMessages("import { z } from 'zod'")

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ line: 1, ruleId: RULE_ID })
  })

  it('rejects legacy re-exports and runtime module loads', async () => {
    const messages = await ruleMessages(`
      export { z } from 'zod/v3'
      const runtime = require('zod')
      const lazy = import('zod/v3')
    `)

    expect(messages.map(({ line }) => line)).toEqual([2, 3, 4])
  })

  it('rejects deprecated string format methods', async () => {
    const messages = await ruleMessages(`
      import zodDefault, { z as schema } from 'zod/v4'
      import * as zodNamespace from 'zod/v4'
      const id = schema.string().uuid()
      const instant = schema.string().datetime({ offset: true })
      const url = zodDefault.string().url()
      const email = zodNamespace.string().email()
    `)

    expect(messages.map(({ line }) => line)).toEqual([4, 5, 6, 7])
  })

  it('accepts explicit v4 imports and current format schemas', async () => {
    const messages = await ruleMessages(`
      import { z } from 'zod/v4'
      const id = z.uuid()
      const instant = z.iso.datetime({ offset: true })
    `)

    expect(messages).toEqual([])
  })

  it('does not treat comments or string literals as code', async () => {
    const messages = await ruleMessages(`
      // import { z } from 'zod'
      const migrationNote = "replace z.string().uuid()"
    `)

    expect(messages).toEqual([])
  })
})
