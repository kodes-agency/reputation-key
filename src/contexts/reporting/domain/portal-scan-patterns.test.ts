import { describe, expect, it } from 'vitest'
import { portalScanPatterns } from './portal-scan-patterns'
const row = (hour: number, scans: number, weekday = 0, channel: 'qr' | 'nfc' = 'qr') => ({
  hour,
  scans,
  weekday,
  channel,
})

describe('scan patterns', () => {
  it.each([
    { name: 'below the floor', rows: [row(12, 29)], busiest: null },
    {
      name: 'exactly the floor',
      rows: [row(12, 30)],
      busiest: { slots: [{ startHour: 11, endHour: 13 }], weekday: 0 },
    },
    {
      name: 'adjacent hours beat individual hours',
      rows: [row(12, 30), row(13, 25), row(19, 20)],
      busiest: { slots: [{ startHour: 12, endHour: 14 }], weekday: 0 },
    },
    {
      name: 'runner-up at exactly eighty percent',
      rows: [row(12, 30), row(13, 20), row(19, 20), row(20, 20)],
      busiest: {
        slots: [
          { startHour: 12, endHour: 14 },
          { startHour: 19, endHour: 21 },
        ],
        weekday: 0,
      },
    },
    {
      name: 'runner-up below eighty percent',
      rows: [row(12, 30), row(13, 20), row(19, 20), row(20, 19)],
      busiest: { slots: [{ startHour: 12, endHour: 14 }], weekday: 0 },
    },
    {
      name: 'midnight wraps without overlap',
      rows: [row(23, 30), row(0, 20), row(1, 10)],
      busiest: { slots: [{ startHour: 23, endHour: 1 }], weekday: 0 },
    },
    {
      name: 'no weekday stands out',
      rows: Array.from({ length: 7 }, (_, day) => row(12, 5, day)),
      busiest: { slots: [{ startHour: 11, endHour: 13 }], weekday: null },
    },
    {
      name: 'weekend uses Monday-zero indexing',
      rows: [row(12, 40, 5)],
      busiest: { slots: [{ startHour: 11, endHour: 13 }], weekday: 5 },
    },
  ])('$name', ({ rows, busiest }) =>
    expect(portalScanPatterns(rows).busiest).toEqual(busiest),
  )
  it('keeps QR and NFC independent', () =>
    expect(portalScanPatterns([row(1, 3), row(2, 2, 0, 'nfc')])).toEqual({
      channels: { qr: 3, nfc: 2 },
      busiest: null,
    }))
})
