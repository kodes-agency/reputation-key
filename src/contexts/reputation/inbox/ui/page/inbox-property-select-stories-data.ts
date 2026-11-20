// Shared fixtures for the property select's stories: three hotels and their
// Needs reply counts (23 = 12 + 8 + 3, the canvas's own numbers), and the one
// reading of an open list those stories assert.
import { expect, waitFor, within } from 'storybook/test'
import type { InboxPropertyCounts } from '#/contexts/inbox/application/public-api'
import type { InboxScopeProperty } from './inbox-property-scope'

export const hotels: ReadonlyArray<InboxScopeProperty> = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Hotel Elegance' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Rila Grand Hotel' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Black Sea Residence' },
]

export const hotelCounts: InboxPropertyCounts = {
  queue: 'reply',
  total: 23,
  byProperty: { [hotels[0].id]: 12, [hotels[1].id]: 8, [hotels[2].id]: 3 },
}

/** Waits for the open list to read All properties then each hotel by name, counted. */
export async function expectHotelOptions(list: ReturnType<typeof within>) {
  await waitFor(() =>
    expect(
      list.getAllByRole('option').map((option: HTMLElement) => option.textContent),
    ).toEqual([
      'All properties23',
      'Black Sea Residence3',
      'Hotel Elegance12',
      'Rila Grand Hotel8',
    ]),
  )
}
