import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { GUEST_LOCALE_METADATA, matchGuestLocale } from '#/shared/domain/guest-locale'
import { formatNumber } from '#/lib/format'
import { languageRows, languagesAreHeldBack } from './portal-results-languages'

function scansWord(total: number): string {
  if (total === 1) return 'The 1 scan'
  return total === 2 ? 'Both scans' : `All ${formatNumber(total)} scans`
}
function channelLine(data: PortalAnalyticsData): string | null {
  if (data.kpis.scans.value === null || data.kpis.scans.evidence.state !== 'ready')
    return null
  const channels = data.scanPatterns?.channels
  if (!channels || channels.qr + channels.nfc === 0) return null
  const { qr, nfc } = channels
  if (qr > 0 && nfc > 0)
    return `${formatNumber(qr)} ${qr === 1 ? 'scan' : 'scans'} came from the QR code and ${formatNumber(nfc)} from the NFC tag.`
  const total = qr + nfc
  return `${scansWord(total)} came from the ${qr > 0 ? 'QR code' : 'NFC tag'}.`
}
function languageLine(data: PortalAnalyticsData): string | null {
  if (
    languagesAreHeldBack(data.kpis.ratings.evidence.state) ||
    data.kpis.ratings.evidence.state !== 'ready' ||
    data.kpis.ratings.value === null
  )
    return null
  const rows = languageRows(data.ratingLanguages).rows.filter(
    (row) => row.key !== 'unrecorded',
  )
  const name = (key: string) => {
    const locale = matchGuestLocale(key)
    return locale ? GUEST_LOCALE_METADATA[locale].englishName : key
  }
  const [first, second] = rows
  if (!first) return null
  return second
    ? `Guests who rated read the page mostly in ${name(first.key)} (${first.percent}%), then ${name(second.key)} (${second.percent}%).`
    : `Guests who rated read the page in ${name(first.key)}.`
}
function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`
}
function slotLabel(slot: Readonly<{ startHour: number; endHour: number }>) {
  const start = hourLabel(slot.startHour)
  const end = hourLabel(slot.endHour)
  return `${Math.floor(slot.startHour / 12) === Math.floor(slot.endHour / 12) ? start.split(' ')[0] : start}–${end}`
}
function busiestLine(data: PortalAnalyticsData): string | null {
  if (data.kpis.scans.value === null || data.kpis.scans.evidence.state !== 'ready')
    return null
  const busiest = data.scanPatterns?.busiest
  if (!busiest) return null
  const weekday =
    busiest.weekday === null
      ? null
      : [
          'Mondays',
          'Tuesdays',
          'Wednesdays',
          'Thursdays',
          'Fridays',
          'Saturdays',
          'Sundays',
        ][busiest.weekday]
  return `Busiest around ${busiest.slots.map(slotLabel).join(' and ')}${weekday ? `, and on ${weekday}` : ''}.`
}
/** Three quiet observations at most; no second chart or language ranking. */
export function portalResultsQuietLines(
  data: PortalAnalyticsData,
  scansCounted: boolean,
) {
  return {
    channel: scansCounted ? channelLine(data) : null,
    language: languageLine(data),
    busiest: scansCounted ? busiestLine(data) : null,
  }
}
