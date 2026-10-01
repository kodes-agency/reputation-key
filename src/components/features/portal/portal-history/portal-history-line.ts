// One History entry as a sentence: who did what, and the detail after the dot.
// Pure: the view draws the pieces, this decides the words. Page edits have
// their own module (portal-history-edit-line.ts).

import type {
  PortalHistoryEntry,
  PortalHistoryDetail,
} from '#/contexts/portal/application/public-api'
import { describePageEditLine } from './portal-history-edit-line'
import type { HistoryLine } from './portal-history-line-types'
import { plain, strong, type Phrase } from './portal-history-phrase'
import { formatHistoryTime } from './portal-history-time'

type LineContext = Readonly<{
  portalName: string
  /** For a publication: what the version added, from the versions read. */
  versionSummary: Phrase | null
  /** The Property's zone and the current time: a date reads in the zone every other line does. */
  timeZone: string
  now: Date
}>

const personOf = (entry: PortalHistoryEntry): string | null =>
  entry.actor === null ? null : (entry.actor.displayName ?? 'Someone')

const HEALTH_DETAIL: Readonly<Record<string, string>> = {
  responsibility_needed: 'no one is responsible for it',
  google_destination_awaiting_refresh: 'the Google link is being refreshed',
  google_destination_unavailable: 'the Google link is not available',
  publication_draft: 'it is not published',
  publication_disabled: 'it is turned off',
  publication_archived: 'it is archived',
  property_unavailable: 'its property is unavailable',
  publication_snapshot_unavailable: 'the live version could not be read',
  public_address_unavailable: 'it has no working code',
}

function describeHealth(
  detail: Extract<PortalHistoryDetail, { kind: 'health_changed' }>,
): HistoryLine {
  const base = { actor: null, action: [] as Phrase }
  if (detail.status === 'healthy') {
    return {
      ...base,
      glyph: 'health_ok',
      action: [strong('Health:'), plain(' back to working')],
      detail: null,
    }
  }
  const reason = HEALTH_DETAIL[detail.reason]
  return {
    ...base,
    glyph: detail.status === 'degraded' ? 'health_warn' : 'health_off',
    action: [
      strong('Health:'),
      plain(detail.status === 'degraded' ? ' needs attention' : ' not available'),
    ],
    detail: reason === undefined ? null : [plain(reason)],
  }
}

function describeCode(
  entry: PortalHistoryEntry,
  detail: Extract<
    PortalHistoryDetail,
    { kind: 'code_issued' | 'code_replaced' | 'codes_revoked' | 'code_downloaded' }
  >,
  context: LineContext,
): HistoryLine {
  const actor = personOf(entry)
  switch (detail.kind) {
    case 'code_issued':
      return {
        glyph: 'code',
        actor,
        action: actor === null ? [plain('A code was made')] : [plain('made a code')],
        detail: null,
      }
    case 'code_replaced': {
      const until = detail.previousCodesWorkUntil
      return {
        glyph: 'code',
        actor,
        action:
          actor === null
            ? [plain('The code was replaced')]
            : [plain('replaced the code')],
        detail: [
          plain(
            until === null
              ? 'the old one stopped working'
              : `the old one works until ${formatHistoryTime(until, context.now, context.timeZone).date}`,
          ),
        ],
      }
    }
    case 'codes_revoked':
      return {
        glyph: 'stopped',
        actor,
        action:
          actor === null
            ? [plain('All codes were stopped')]
            : [plain('stopped all codes')],
        detail:
          detail.reason === null || detail.reason === '' ? null : [plain(detail.reason)],
      }
    case 'code_downloaded':
      return {
        glyph: detail.purpose === 'download' ? 'download' : 'copy',
        actor: actor ?? 'Someone',
        action: [
          plain(
            detail.purpose === 'download'
              ? 'downloaded the code again'
              : detail.purpose === 'copy'
                ? 'copied the NFC address'
                : 'viewed the address',
          ),
        ],
        detail: null,
      }
  }
}

/** The sentence for one entry. */
export function describeHistoryEntry(
  entry: PortalHistoryEntry,
  context: LineContext,
): HistoryLine {
  const { detail } = entry
  const actor = personOf(entry)
  switch (detail.kind) {
    case 'portal_created':
      return {
        glyph: 'created',
        actor,
        action:
          actor === null
            ? [strong(context.portalName), plain(' was created')]
            : [plain('created '), strong(context.portalName)],
        detail: null,
      }
    case 'version_published':
      return {
        glyph: 'published',
        actor: actor ?? 'Someone',
        action: [plain('published '), strong(`version ${detail.version}`)],
        detail: context.versionSummary,
      }
    case 'version_restored':
      return {
        glyph: 'restored',
        actor: actor ?? 'Someone',
        action: [
          plain('made '),
          strong(`version ${detail.version}`),
          plain(' live again'),
        ],
        detail: null,
      }
    case 'health_changed':
      return describeHealth(detail)
    case 'page_edited':
      return describePageEditLine(personOf(entry), detail)
    case 'code_issued':
    case 'code_replaced':
    case 'codes_revoked':
    case 'code_downloaded':
      return describeCode(entry, detail, context)
  }
}
