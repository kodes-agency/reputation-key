import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('invitation email rate-limit wiring', () => {
  it.each([
    [
      'src/contexts/identity/server/organizations.members.ts',
      'await identityPublicApi.requests.inviteMember',
    ],
    [
      'src/contexts/identity/server/organizations.invitations.ts',
      'await identityPublicApi.requests.resendInvitation',
    ],
  ])('guards %s before the email-sending use case', (path, useCaseCall) => {
    const contents = source(path)
    const guard = contents.indexOf('await enforceInvitationSendRateLimit')
    const effect = contents.indexOf(useCaseCall)

    expect(guard).toBeGreaterThan(-1)
    expect(effect).toBeGreaterThan(guard)
  })
})
