import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONTEXTS = resolve(import.meta.dirname, '../../contexts')
// WP2.3 narrowed this, and narrowing it was unavoidable rather than a
// concession. While the gateway was a separate process, NOTHING in an
// application or context module had any business naming its internals, so the
// list could include every gateway-private module. In-process, the adapter that
// implements `AiInferencePort` lives in a context and must construct the
// scrubbing lease it hands the gateway — so `source-lease` is now a legitimate
// dependency, and `source-reader` no longer exists at all (it parsed a request
// body off a socket).
//
// What still holds, and is the whole point: no context module may reach a
// provider connector or import a provider SDK. Those are the two ways a second
// egress path gets built, and neither is reachable from here. The connectors are
// the modules that open the connection (the undici boundary, each provider's
// connector and adapter, the local stub fetches); the selection, lease, service
// and admission modules a context does import are not among them.
const PROVIDER_CONNECTOR_REFERENCE =
  /shared\/ai-provider-control\/(?:connector-boundary|openai-connector|(?:openai-)?provider-adapter|local-provider-fetch|anthropic\/)/
const PROVIDER_SDK_IMPORT =
  /(?:\bfrom\s+|\bimport\s*\(?\s*)['"](?:openai|@anthropic-ai\/sdk)(?:\/[^'"]*)?['"]/

describe('AI gateway source boundary', () => {
  it('keeps context modules away from the provider connectors and SDKs', () => {
    const files = globSync('**/*.{ts,tsx}', { cwd: CONTEXTS })
    // A scan that found nothing would pass whatever the contexts import.
    expect(files.length).toBeGreaterThan(1000)

    const violations = files.filter((relativePath) => {
      const source = readFileSync(resolve(CONTEXTS, relativePath), 'utf8')
      return PROVIDER_CONNECTOR_REFERENCE.test(source) || PROVIDER_SDK_IMPORT.test(source)
    })
    expect(violations).toEqual([])
  })
})
