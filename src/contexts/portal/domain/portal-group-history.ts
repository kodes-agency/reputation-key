// Portal context — Portal Group history ledger entries.
//
// The ledger records what happened to a group and to the Portals in it, with
// the wording that was true at the time (the group's name and its previous
// name). Events carry identifiers only (ADR 0030), so names live here.
// Entries are built by the command stores inside the same transaction as the
// change they describe; this module is the one place that says which fields
// each kind of entry needs.

import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import { portalError } from './errors'
import { validateGroupName } from './rules'

export const PORTAL_GROUP_HISTORY_KINDS = [
  'created',
  'renamed',
  'archived',
  'portal_added',
  'portal_removed',
  'portal_moved_in',
  'portal_moved_out',
] as const

export type PortalGroupHistoryKind = (typeof PORTAL_GROUP_HISTORY_KINDS)[number]

/** A ledger entry before the database gives it an id. */
export type PortalGroupHistoryDraft = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  kind: PortalGroupHistoryKind
  portalId: PortalId | null
  /** The group on the other side of a move. */
  otherGroupId: PortalGroupId | null
  /** The group's name at the time: its first name, or the name after a rename. */
  name: string | null
  previousName: string | null
  actorUserId: string
  occurredAt: Date
}>

export type PortalGroupHistoryEntry = PortalGroupHistoryDraft & Readonly<{ id: string }>

type EntryInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  kind: PortalGroupHistoryKind
  actorUserId: string
  occurredAt: Date
  portalId?: PortalId
  otherGroupId?: PortalGroupId
  name?: string
  previousName?: string
}>

function invalid(message: string): never {
  throw portalError('forbidden', `Portal Group history: ${message}`)
}

/** Which fields each kind of entry carries; every other field must be empty. */
type Shape = Readonly<{
  portal: boolean
  otherGroup: boolean
  name: boolean
  previousName: boolean
}>

const NONE: Shape = { portal: false, otherGroup: false, name: false, previousName: false }
const SHAPES: Readonly<Record<PortalGroupHistoryKind, Shape>> = {
  created: { ...NONE, name: true },
  renamed: { ...NONE, name: true, previousName: true },
  archived: NONE,
  portal_added: { ...NONE, portal: true },
  portal_removed: { ...NONE, portal: true },
  portal_moved_in: { ...NONE, portal: true, otherGroup: true },
  portal_moved_out: { ...NONE, portal: true, otherGroup: true },
}

function assertFieldPresence(
  kind: PortalGroupHistoryKind,
  fields: Readonly<Record<keyof Shape, unknown>>,
): void {
  const shape = SHAPES[kind]
  for (const field of Object.keys(shape) as Array<keyof Shape>) {
    const present = fields[field] !== undefined
    if (present !== shape[field]) {
      invalid(`${kind} ${shape[field] ? 'needs' : 'must not carry'} ${field}`)
    }
  }
}

export const portalGroupHistoryEntry = (input: EntryInput): PortalGroupHistoryDraft => {
  assertFieldPresence(input.kind, {
    portal: input.portalId,
    otherGroup: input.otherGroupId,
    name: input.name,
    previousName: input.previousName,
  })
  const named = SHAPES[input.kind].name
  return {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalGroupId: input.portalGroupId,
    kind: input.kind,
    portalId: input.portalId ?? null,
    otherGroupId: input.otherGroupId ?? null,
    name: named ? validName(input.name) : null,
    previousName: input.previousName ?? null,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt,
  }
}

function validName(value: string | undefined): string {
  const valid = validateGroupName(value ?? '')
  if (valid.isErr()) throw valid.error
  return valid.value
}

/**
 * What a move writes: an entry on the group the Portal left and one on the
 * group it joined. A Portal that had no group is a plain addition.
 */
export const groupMovementEntries = (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    fromGroupId: PortalGroupId | null
    toGroupId: PortalGroupId
    actorUserId: string
    occurredAt: Date
  }>,
): ReadonlyArray<PortalGroupHistoryDraft> => {
  const { fromGroupId, toGroupId, ...common } = input
  if (!fromGroupId) {
    return [
      portalGroupHistoryEntry({
        ...common,
        portalGroupId: toGroupId,
        kind: 'portal_added',
      }),
    ]
  }
  return [
    portalGroupHistoryEntry({
      ...common,
      portalGroupId: fromGroupId,
      kind: 'portal_moved_out',
      otherGroupId: toGroupId,
    }),
    portalGroupHistoryEntry({
      ...common,
      portalGroupId: toGroupId,
      kind: 'portal_moved_in',
      otherGroupId: fromGroupId,
    }),
  ]
}
