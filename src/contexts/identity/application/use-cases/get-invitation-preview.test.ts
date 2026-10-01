// Identity context — invitation link preview.
// Anonymous: whoever holds the link learns only what the invitation email
// already told its recipient, plus whether the address has an account. Every
// id that is not a usable beta invitation reads the same way.

import { describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId } from '#/shared/domain/ids'
import { getInvitationPreview } from './get-invitation-preview'
import type {
  InvitationPreviewRow,
  InvitationReadModel,
  PropertyNameLookup,
} from '../ports/invitation-read-model.port'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const ORG_ID = organizationId('org-preview')

const previewRow = (patch: Partial<InvitationPreviewRow> = {}): InvitationPreviewRow => ({
  id: 'inv-preview',
  organizationId: ORG_ID,
  organizationName: 'Riverside Hotels',
  email: 'new.manager@example.com',
  role: 'admin',
  status: 'pending',
  expiresAt: new Date('2026-10-07T12:00:00.000Z'),
  inviterName: 'Ada Admin',
  propertyIds: ['prop-a', 'prop-gone'],
  accountExists: false,
  ...patch,
})

const setup = (row: InvitationPreviewRow | null) => {
  const findForPreview = vi.fn(async () => row)
  const invitations: InvitationReadModel = {
    findForPreview,
    listOpenForOrganization: vi.fn(async () => []),
  }
  const propertyNames = vi.fn<PropertyNameLookup>(async () => [
    { id: 'prop-a', name: 'Hotel A' },
  ])
  const preview = getInvitationPreview({ invitations, propertyNames, clock: () => NOW })
  return { preview, findForPreview, propertyNames }
}

describe('getInvitationPreview', () => {
  it('describes a pending invitation as its email did', async () => {
    const { preview, findForPreview, propertyNames } = setup(previewRow())

    await expect(preview(invitationId('inv-preview'))).resolves.toEqual({
      state: 'pending',
      invitationId: 'inv-preview',
      organizationName: 'Riverside Hotels',
      inviterName: 'Ada Admin',
      role: 'PropertyManager',
      propertyNames: ['Hotel A'],
      email: 'new.manager@example.com',
      expiresAt: new Date('2026-10-07T12:00:00.000Z'),
      accountExists: false,
    })
    expect(findForPreview).toHaveBeenCalledWith('inv-preview')
    expect(propertyNames).toHaveBeenCalledWith(ORG_ID, ['prop-a', 'prop-gone'])
  })

  it('says whether the address already has an account', async () => {
    const { preview } = setup(previewRow({ accountExists: true }))

    await expect(preview(invitationId('inv-preview'))).resolves.toMatchObject({
      state: 'pending',
      accountExists: true,
    })
  })

  it('names no Properties for an AccountAdmin invitation', async () => {
    const { preview, propertyNames } = setup(previewRow({ role: 'owner' }))

    await expect(preview(invitationId('inv-preview'))).resolves.toMatchObject({
      state: 'pending',
      role: 'AccountAdmin',
      propertyNames: [],
    })
    expect(propertyNames).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a lapsed pending invitation',
      { expiresAt: new Date('2026-09-29T12:00:00.000Z') },
      'expired',
    ],
    ['a stored expired invitation', { status: 'expired' }, 'expired'],
    ['a canceled invitation', { status: 'canceled' }, 'canceled'],
    ['an accepted invitation', { status: 'accepted' }, 'accepted'],
  ] as const)('tells the holder of %s only who sent it', async (_name, patch, state) => {
    const { preview, propertyNames } = setup(previewRow(patch))

    await expect(preview(invitationId('inv-preview'))).resolves.toEqual({
      state,
      organizationName: 'Riverside Hotels',
      inviterName: 'Ada Admin',
    })
    expect(propertyNames).not.toHaveBeenCalled()
  })

  it('reads an unknown id, a rejected invitation, an unknown status and a non-beta role identically', async () => {
    const outcomes = await Promise.all(
      [
        null,
        previewRow({ status: 'rejected' }),
        previewRow({ status: 'archived' }),
        previewRow({ role: 'member' }),
        previewRow({ role: null }),
      ].map((row) => setup(row).preview(invitationId('inv-preview'))),
    )

    for (const outcome of outcomes) {
      expect(outcome).toStrictEqual({ state: 'unavailable' })
    }
  })
})
