import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Anthropic is configured (attested, named by the deployment profile, tested) and not
// selectable: only a reviewed change to the egress runtime can register its adapter or
// hand the deployment its key.

describe('the AI egress provider wiring', () => {
  it('uses the operator selection when it is given no choice, and registers no Anthropic adapter', () => {
    const runtime = readFileSync('src/composition/ai-egress-runtime.ts', 'utf8')
    expect(runtime).toContain('input.providerSelection ?? OPERATOR_PROVIDER_SELECTION')
    expect(runtime).toContain('createOpenAiProviderAdapter(connector)')
    expect(runtime.toLowerCase()).not.toContain('anthropic')
    // The deployment is given no Anthropic key: no production module names the variable.
    for (const file of [
      'src/composition/ai-egress-runtime.ts',
      'src/composition/provider-runtime.ts',
      'src/shared/config/env.ts',
    ]) {
      expect(readFileSync(file, 'utf8')).not.toContain('ANTHROPIC_API_KEY')
    }
  })
})
