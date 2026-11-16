import { describe, expect, it, vi } from 'vitest'
import { deleteTestOrganizations } from './integration-helpers'

describe('integration Organization fixture cleanup', () => {
  it('deletes each distinct Better Auth Organization once', async () => {
    const query = vi.fn(async () => ({ rows: [] }))

    await deleteTestOrganizations(
      { query } as Parameters<typeof deleteTestOrganizations>[0],
      ['org-b', 'org-a', 'org-b'],
    )

    expect(query.mock.calls).toEqual([
      ['DELETE FROM organization WHERE id = ANY($1::text[])', [['org-b', 'org-a']]],
    ])
  })

  it('does no work for an empty fixture set', async () => {
    const query = vi.fn(async () => ({ rows: [] }))

    await deleteTestOrganizations(
      { query } as Parameters<typeof deleteTestOrganizations>[0],
      [],
    )

    expect(query).not.toHaveBeenCalled()
  })
})
