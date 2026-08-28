import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Google credential broker durable boundary', () => {
  it('does not retain a production in-memory grant/nonce replay authority', () => {
    const source = readFileSync(
      'src/shared/google-provider-control/credential-broker-contract.ts',
      'utf8',
    )
    expect(source).not.toContain('createInMemoryGoogleCredentialBrokerReplayStore')
    expect(source).not.toContain('const grants = new Map')
  })
})
