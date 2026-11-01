import type { GuestResponseScope } from './guest-response.repository'

/** Internal aggregate only: Reporting reduces these counts before sending them to a browser. */
export type PortalScanPatternCounts = ReadonlyArray<
  Readonly<{
    channel: 'qr' | 'nfc'
    hour: number
    weekday: number
    scans: number
  }>
>
export type PortalScanPatternsReader = (
  input: GuestResponseScope &
    Readonly<{
      startAt: Date
      endAt: Date
      timezone: string
    }>,
) => Promise<PortalScanPatternCounts>
