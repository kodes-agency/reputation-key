import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
const GATEWAY_PRIVATE_REFERENCE =
  /services\/ai-egress-gateway\/(?:source-lease|source-reader|openai-connector|provider)|from ['"]openai(?:\/|['"])/

describe('AI gateway source boundary', () => {
  it('keeps application and context module graphs out of gateway-private source and provider modules', () => {
    const violations: string[] = []
    for (const relativePath of globSync('**/*.{ts,tsx}', {
      cwd: resolve(ROOT, 'src/contexts'),
    })) {
      const source = readFileSync(resolve(ROOT, 'src/contexts', relativePath), 'utf8')
      if (GATEWAY_PRIVATE_REFERENCE.test(source)) violations.push(relativePath)
    }
    expect(violations).toEqual([])
  })
})
