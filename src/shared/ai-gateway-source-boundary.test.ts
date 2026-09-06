import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
// WP2.3 narrowed this, and narrowing it was unavoidable rather than a
// concession. While the gateway was a separate process, NOTHING in an
// application or context module had any business naming its internals, so the
// list could include every gateway-private module. In-process, the adapter that
// implements `AiInferencePort` lives in a context and must construct the
// scrubbing lease it hands the gateway — so `source-lease` is now a legitimate
// dependency, and `source-reader` no longer exists at all (it parsed a request
// body off a socket).
//
// What still holds, and is the whole point: no application or context module may
// reach the provider connector or import the OpenAI SDK. Those are the two ways
// a second egress path gets built, and neither is reachable from here.
const GATEWAY_PRIVATE_REFERENCE =
  /shared\/ai-provider-control\/(?:openai-connector|provider)|from ['"]openai(?:\/|['"])/

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
