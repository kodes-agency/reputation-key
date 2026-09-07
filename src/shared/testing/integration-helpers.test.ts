import { describe, expect, it, vi } from 'vitest'
import { deleteTestOrganizations } from './integration-helpers'

describe('integration Organization fixture cleanup', () => {
  it('deletes lifecycle/export tombstones before the Better Auth Organization', async () => {
    const query = vi.fn(async () => ({ rows: [] }))

    await deleteTestOrganizations(
      { query } as Parameters<typeof deleteTestOrganizations>[0],
      ['org-b', 'org-a', 'org-b'],
    )

    expect(query.mock.calls).toEqual([
      [
        'ALTER TABLE organization_lifecycle_events DISABLE TRIGGER organization_lifecycle_events_append_only',
      ],
      [
        'DELETE FROM organization_lifecycle_events WHERE organization_id = ANY($1::text[])',
        [['org-b', 'org-a']],
      ],
      [
        'ALTER TABLE organization_lifecycle_events ENABLE ALWAYS TRIGGER organization_lifecycle_events_append_only',
      ],
      [
        'DELETE FROM organization_exports WHERE organization_id = ANY($1::text[])',
        [['org-b', 'org-a']],
      ],
      [
        'DELETE FROM organization_lifecycle_authority WHERE organization_id = ANY($1::text[])',
        [['org-b', 'org-a']],
      ],
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
