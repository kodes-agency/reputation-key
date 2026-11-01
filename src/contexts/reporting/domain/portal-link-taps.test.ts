import { expect, it } from 'vitest'
import { portalLinkTaps } from './portal-link-taps'
const links = {
  enabled: true,
  rows: ['a', 'b', 'c'].map((linkId) => ({ linkId, label: linkId, iconKey: null })),
}
it('includes zeroes, sorts by taps then portal order and separates removed links', () => {
  expect(
    portalLinkTaps(links, [
      { linkId: 'b', taps: 3 },
      { linkId: 'a', taps: 3 },
      { linkId: 'gone', taps: 2 },
    ]),
  ).toEqual({
    total: 8,
    countedSince: '2026-11-01',
    removedTaps: 2,
    rows: [
      { ...links.rows[0], taps: 3 },
      { ...links.rows[1], taps: 3 },
      { ...links.rows[2], taps: 0 },
    ],
  })
})
it.each([
  { enabled: false, rows: links.rows },
  { enabled: true, rows: [] },
])('hides an unused linktree', (links) => expect(portalLinkTaps(links, [])).toBeNull())
it('keeps historical taps when the linktree is off', () =>
  expect(
    portalLinkTaps({ ...links, enabled: false }, [{ linkId: 'a', taps: 1 }])?.total,
  ).toBe(1))
