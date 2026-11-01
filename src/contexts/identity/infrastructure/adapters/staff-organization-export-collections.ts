import type { OrganizationExportEntry } from '../../application/ports/organization-export-contributor.port'
import {
  csvEntry,
  jsonEntry,
  type StaffOrganizationExportPayload,
  type ExportCollection,
} from './staff-organization-export-format'

const PARTICIPANT_COLUMNS = [
  'id',
  'display_name',
  'status',
  'revision',
  'archived_at',
  'archive_reason',
  'created_by',
  'created_at',
  'updated_at',
] as const

const PARTICIPANT_USER_LINK_COLUMNS = [
  'id',
  'staff_participant_id',
  'user_id',
  'notice_version',
  'notice_acknowledged_at',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

const PARTICIPATION_COLUMNS = [
  'id',
  'property_id',
  'staff_participant_id',
  'personal_portal_id',
  'user_id',
  'display_name',
  'status',
  'revision',
  'started_at',
  'ended_at',
  'archive_reason',
  'created_by',
  'created_at',
  'updated_at',
] as const

const PORTAL_RESPONSIBILITY_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'staff_participation_id',
  'kind',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

const PORTAL_GROUP_MEMBERSHIP_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'portal_group_id',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

export function buildEntries(
  payload: StaffOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const groups: readonly Readonly<{
    slug: string
    collections: readonly ExportCollection[]
    json: unknown
  }>[] = [
    {
      slug: 'participants',
      collections: [
        {
          recordType: 'staff_participant',
          columns: PARTICIPANT_COLUMNS,
          records: payload.participants,
        },
        {
          recordType: 'staff_participant_user_link',
          columns: PARTICIPANT_USER_LINK_COLUMNS,
          records: payload.participantUserLinks,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        participants: payload.participants,
        participantUserLinks: payload.participantUserLinks,
        excludedRecordClasses: payload.excludedRecordClasses,
      },
    },
    {
      slug: 'participations',
      collections: [
        {
          recordType: 'staff_participation',
          columns: PARTICIPATION_COLUMNS,
          records: payload.participations,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        participations: payload.participations,
      },
    },
    {
      slug: 'portal-responsibilities',
      collections: [
        {
          recordType: 'portal_responsibility',
          columns: PORTAL_RESPONSIBILITY_COLUMNS,
          records: payload.portalResponsibilities,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        portalResponsibilities: payload.portalResponsibilities,
      },
    },
    {
      slug: 'portal-group-memberships',
      collections: [
        {
          recordType: 'portal_group_membership',
          columns: PORTAL_GROUP_MEMBERSHIP_COLUMNS,
          records: payload.portalGroupMemberships,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        portalGroupMemberships: payload.portalGroupMemberships,
      },
    },
  ]

  const accounts = [
    {
      recordType: 'staff_onboarding',
      columns: [
        'id',
        'property_id',
        'email',
        'display_name',
        'source_portal_id',
        'portal_group_id',
        'requested_by',
        'status',
        'step',
        'staff_participant_id',
        'staff_participation_id',
        'portal_id',
        'invitation_id',
        'failure_code',
        'created_at',
        'updated_at',
      ],
      records: payload.onboardings,
    },
    {
      recordType: 'staff_property_settings',
      columns: ['property_id', 'colleague_list_enabled', 'updated_by', 'updated_at'],
      records: payload.propertySettings,
    },
  ]
  const withAccounts =
    payload.onboardings.length + payload.propertySettings.length === 0
      ? groups
      : [
          ...groups,
          {
            slug: 'accounts',
            collections: accounts,
            json: {
              onboardings: payload.onboardings,
              propertySettings: payload.propertySettings,
            },
          },
        ]
  return withAccounts.flatMap(({ slug, collections, json }) => [
    csvEntry(`staff/${slug}.csv`, collections),
    jsonEntry(`staff/${slug}.json`, json),
  ])
}

export function countRecords(payload: StaffOrganizationExportPayload): number {
  return (
    payload.participants.length +
    payload.participantUserLinks.length +
    payload.participations.length +
    payload.portalResponsibilities.length +
    payload.portalGroupMemberships.length +
    payload.onboardings.length +
    payload.propertySettings.length
  )
}
