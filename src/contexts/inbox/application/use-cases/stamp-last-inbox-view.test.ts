import { describe, expect, it, vi } from 'vitest'
import { stampLastInboxView } from './stamp-last-inbox-view'
import {
  organizationId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import { isInboxError } from '../../domain/errors'

const NOW = new Date('2026-08-27T12:00:10.000Z')
const CUTOFF = new Date('2026-08-27T12:00:00.000Z')
const ORG_ID = organizationId('org-inbox-cutoff')
const USER_ID = userId('user-inbox-cutoff')
const CTX = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'AccountAdmin',
} as AuthContext

const setup = () => {
  const stamp = vi.fn(async (_org: OrganizationId, _user: UserId, cutoff: Date) => cutoff)
  const viewRepo: InboxViewRepository = {
    getLastInboxView: vi.fn(async () => null),
    stampLastInboxView: stamp,
  }
  return {
    stamp,
    run: stampLastInboxView({ viewRepo, clock: () => NOW }),
  }
}

describe('stampLastInboxView', () => {
  it('stamps the server response cutoff rather than request completion time', async () => {
    const { run, stamp } = setup()

    await expect(run({ responseCutoff: CUTOFF }, CTX)).resolves.toEqual(CUTOFF)
    expect(stamp).toHaveBeenCalledWith(ORG_ID, USER_ID, CUTOFF)
  })

  it('rejects a cutoff later than the current server clock', async () => {
    const { run, stamp } = setup()
    const future = new Date(NOW.getTime() + 1)

    await expect(run({ responseCutoff: future }, CTX)).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect(stamp).not.toHaveBeenCalled()
  })
})
