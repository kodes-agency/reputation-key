// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// A group's history as the page prints it (board 13): a short ledger, newest
// first, one line per thing that happened to the group and a quiet second line
// where something needs saying (where a moved portal's earlier results stay).
// Pure: the page hands in the ledger and a way to name people, portals and
// groups, and everything printed is decided here.
//
// The ledger stores identifiers and the group's own wording at the time; names of
// people and portals are looked up now, and one that cannot be resolved is a
// plain word ("Someone", "A portal"), never an identifier.
import type { PortalGroupHistoryEntry } from '#/contexts/portal/application/public-api'
import { formatDate, formatDayKey, formatMonthDay } from '#/lib/format'

export type HistoryNames = Readonly<{
  actor: (userId: string) => string | null
  portal: (portalId: string) => string | null
  /** A group by id; null for one that is archived or unknown. */
  group: (groupId: string) => string | null
}>

export type HistoryFrame = Readonly<{
  /** The group's name today, for lines that say where results stay. */
  groupName: string
  /** The property's time zone: an entry belongs to the property day it happened on. */
  timezone: string
  now: Date
}>

export type PortalGroupHistoryLineKind =
  'created' | 'renamed' | 'archived' | 'added' | 'removed' | 'moved_in' | 'moved_out'

export type PortalGroupHistoryLine = Readonly<{
  id: string
  kind: PortalGroupHistoryLineKind
  text: string
  detail: string | null
  /** "Aug 14", or "Dec 30, 2025" for an earlier year. */
  dateLabel: string
  /** For `<time dateTime>`. */
  occurredAt: string
}>

const SOMEONE = 'Someone'
const A_PORTAL = 'A portal'
const ANOTHER_GROUP = 'another group'
const THAT_GROUP = 'that group'

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "Aug 14": the month and day in the property's own day, with the year in another year. */
function dateLabelOf(at: Date, frame: HistoryFrame): string {
  const sameYear =
    formatDayKey(at, frame.timezone)?.slice(0, 4) ===
    formatDayKey(frame.now, frame.timezone)?.slice(0, 4)
  return (
    (sameYear ? formatMonthDay(at, frame.timezone) : formatDate(at, frame.timezone)) ?? ''
  )
}

/** What a move writes into the history, so the creation line can count what it began with. */
const joins = (kind: PortalGroupHistoryEntry['kind']): boolean =>
  kind === 'portal_added' || kind === 'portal_moved_in'

function isCreationCompanion(
  entry: PortalGroupHistoryEntry,
  creation: PortalGroupHistoryEntry | undefined,
): boolean {
  return (
    creation !== undefined &&
    joins(entry.kind) &&
    entry.actorUserId === creation.actorUserId &&
    entry.occurredAt.getTime() === creation.occurredAt.getTime()
  )
}

/** Within one instant the creation is the oldest line, so it prints last. */
const RANK: Readonly<Record<PortalGroupHistoryEntry['kind'], number>> = {
  archived: 0,
  renamed: 1,
  portal_moved_out: 2,
  portal_removed: 3,
  portal_moved_in: 4,
  portal_added: 5,
  created: 6,
}

const newestFirst = (left: PortalGroupHistoryEntry, right: PortalGroupHistoryEntry) =>
  right.occurredAt.getTime() - left.occurredAt.getTime() ||
  RANK[left.kind] - RANK[right.kind]

export function buildPortalGroupHistory(
  entries: readonly PortalGroupHistoryEntry[],
  names: HistoryNames,
  frame: HistoryFrame,
): readonly PortalGroupHistoryLine[] {
  const creation = entries.find((entry) => entry.kind === 'created')
  const companions = entries.filter((entry) => isCreationCompanion(entry, creation))
  const actor = (entry: PortalGroupHistoryEntry) =>
    names.actor(entry.actorUserId) ?? SOMEONE
  const portal = (entry: PortalGroupHistoryEntry) =>
    (entry.portalId === null ? null : names.portal(entry.portalId)) ?? A_PORTAL
  const other = (entry: PortalGroupHistoryEntry) =>
    (entry.otherGroupId === null ? null : names.group(entry.otherGroupId)) ?? null
  const dated = (entry: PortalGroupHistoryEntry) => ({
    id: entry.id,
    dateLabel: dateLabelOf(entry.occurredAt, frame),
    occurredAt: entry.occurredAt.toISOString(),
  })
  const stays = (entry: PortalGroupHistoryEntry, where: string) =>
    `Its results before ${dateLabelOf(entry.occurredAt, frame)} stay ${where}`

  const lineOf = (entry: PortalGroupHistoryEntry): PortalGroupHistoryLine | null => {
    const base = dated(entry)
    switch (entry.kind) {
      case 'created': {
        // Entries of one instant have no order of their own: alphabetical is steady.
        const portals = companions.map(portal).sort((a, b) => a.localeCompare(b, 'en'))
        const count = portals.length
        const tail =
          count === 0 ? '' : ` with ${count} ${count === 1 ? 'portal' : 'portals'}`
        return {
          ...base,
          kind: 'created',
          text: `${actor(entry)} created ${entry.name ?? frame.groupName}${tail}`,
          detail: count === 0 ? null : joinNames(portals),
        }
      }
      case 'renamed':
        return {
          ...base,
          kind: 'renamed',
          text: `${actor(entry)} renamed ${entry.previousName ?? 'the group'} to ${entry.name ?? frame.groupName}`,
          detail: null,
        }
      case 'archived':
        return {
          ...base,
          kind: 'archived',
          text: `${actor(entry)} archived ${frame.groupName}`,
          detail: null,
        }
      case 'portal_added':
        // At creation it is part of the creation line.
        if (companions.includes(entry)) return null
        return { ...base, kind: 'added', text: `${portal(entry)} added`, detail: null }
      case 'portal_removed':
        return {
          ...base,
          kind: 'removed',
          text: `${portal(entry)} removed`,
          detail: stays(entry, `with ${frame.groupName}`),
        }
      case 'portal_moved_in': {
        const from = other(entry)
        return {
          ...base,
          kind: 'moved_in',
          text: `${portal(entry)} moved here from ${from ?? ANOTHER_GROUP}`,
          detail: stays(entry, `with ${from ?? THAT_GROUP}`),
        }
      }
      case 'portal_moved_out':
        return {
          ...base,
          kind: 'moved_out',
          text: `${portal(entry)} moved to ${other(entry) ?? ANOTHER_GROUP}`,
          detail: stays(entry, 'here'),
        }
    }
  }

  return [...entries].sort(newestFirst).flatMap((entry) => {
    const line = lineOf(entry)
    return line ? [line] : []
  })
}
