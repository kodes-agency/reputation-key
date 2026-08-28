import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('container-scoped auth lifecycle composition', () => {
  it('does not keep mutable invitation or membership lifecycle hooks in shared auth', () => {
    const auth = readSource('src/shared/auth/auth.ts')

    expect(auth).not.toContain('setOnAcceptInvitation')
    expect(auth).not.toContain('getOnAcceptInvitation')
    expect(auth).not.toContain('setMembershipRemovalLifecycle')
    expect(auth).not.toContain('_onAcceptInvitation')
    expect(auth).not.toContain('_membershipRemovalLifecycle')
  })

  it('injects invitation provisioning into the owning Identity adapter', () => {
    const adapter = readSource(
      'src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts',
    )
    const composition = readSource('src/composition.ts')

    expect(adapter).toContain('deps.onAcceptInvitation')
    expect(composition).toContain('createInvitationPropertyAccessProvisioner')
    expect(composition).not.toContain('setOnAcceptInvitation')
    expect(composition).not.toContain('setMembershipRemovalLifecycle')
  })
})
