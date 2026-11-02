import { it, expect } from 'vitest'
import { portalListModel } from './portal-list-model'
import { overviewRow } from './portal-overview-fixtures'
it('keeps the staff section even with no real groups and removes an unavailable scans sort', () => {
  const model = portalListModel({
    rows: [overviewRow('ana', { kind: 'personal', name: 'Ana' })],
    search: { sort: 'scans' },
    groups: [],
  })
  expect(model.hasGroups).toBe(true)
  expect(model.listSearch.sort).toBeUndefined()
  expect(model.overview.sections[0]?.key).toBe('other-staff')
})
