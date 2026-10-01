// Story data for Review & publish: board 05's portal (two changes since version
// 5, a German link label missing, four languages) and the variations a manager
// can meet. Built on the preview fixtures so the phones draw the same page.

import type { PortalReview, ReviewCheck } from '#/contexts/portal/application/public-api'
import type { PortalData } from '../../shared/types'

export const REVIEW_PROPERTY_ID = '0b6f8a52-4c2e-4d61-9a55-2f1d3c7e9b10'

export const REVIEW_PORTAL: PortalData = {
  id: 'p-1',
  name: 'Pool & Terrace',
  slug: 'pool-terrace',
  description: null,
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1' },
  privateFeedbackThreshold: 3,
  publicationState: 'published',
}

const passed = (code: ReviewCheck['code']): ReviewCheck => ({
  code,
  status: 'passed',
  locale: null,
  keys: [],
})

const ALL_PASSED: readonly ReviewCheck[] = [
  passed('property_available'),
  passed('google_destination'),
  passed('responsible_manager'),
  passed('public_address'),
  passed('primary_text'),
  passed('language_packs'),
  passed('time_zone'),
]

const GEORGI = { userId: 'u-georgi', displayName: 'Georgi Ivanov' }
const ELENA = { userId: 'u-elena', displayName: 'Elena Petrova' }

const LANGUAGES: PortalReview['languages'] = [
  {
    locale: 'en',
    isFallback: true,
    total: 14,
    present: 14,
    missingCount: 0,
    missing: [],
    status: 'complete',
    aiDraftCount: 0,
  },
  {
    locale: 'bg',
    isFallback: false,
    total: 14,
    present: 14,
    missingCount: 0,
    missing: [],
    status: 'complete',
    aiDraftCount: 0,
  },
  {
    locale: 'es',
    isFallback: false,
    total: 14,
    present: 14,
    missingCount: 0,
    missing: [],
    status: 'complete',
    aiDraftCount: 2,
  },
  {
    locale: 'de',
    isFallback: false,
    total: 14,
    present: 13,
    missingCount: 1,
    missing: [
      {
        key: 'link:l-3',
        kind: 'link_label',
        linkId: 'l-3',
        linkLabel: 'Olive Terrace menu',
        blocksPublish: false,
      },
    ],
    status: 'copied_from_fallback',
    aiDraftCount: 0,
  },
]

/** Board 05: live version 5, two changes, one warning, the rest passed. */
export const REVIEW_LIVE_WITH_CHANGES: PortalReview = {
  portalId: 'p-1',
  publicationState: 'published',
  action: 'publish_changes',
  live: { version: 5, activatedAt: '2026-09-29T10:00:00.000Z', activatedBy: GEORGI },
  publishesAsVersion: 6,
  nothingToPublish: false,
  canPublish: true,
  changes: [
    {
      type: 'edit',
      kind: 'portal_links',
      subject: { area: 'link', linkId: 'l-3', change: 'updated' },
      propertyWide: false,
      actor: GEORGI,
      occurredAt: '2026-09-30T09:00:00.000Z',
      previousText: 'Dinner menu',
      newText: 'Olive Terrace menu',
      editCount: 1,
    },
    {
      type: 'edit',
      kind: 'property_brand_content',
      subject: { area: 'welcome_text', locale: 'es' },
      propertyWide: false,
      actor: ELENA,
      occurredAt: '2026-10-01T09:00:00.000Z',
      previousText: 'Zona de piscina',
      newText: 'Piscina y terraza',
      editCount: 1,
    },
  ],
  changesMayBeIncomplete: false,
  checks: [
    { code: 'copied_text', status: 'warning', locale: 'de', keys: ['link:l-3'] },
    ...ALL_PASSED,
  ],
  checkCounts: { blocked: 0, warning: 1, passed: 7 },
  languages: LANGUAGES,
}

/** Nothing stands in the way and nothing is missing. */
export const REVIEW_ALL_CLEAR: PortalReview = {
  ...REVIEW_LIVE_WITH_CHANGES,
  checks: ALL_PASSED,
  checkCounts: { blocked: 0, warning: 0, passed: 7 },
  languages: LANGUAGES.map((row) => ({
    ...row,
    present: row.total,
    missing: [],
    missingCount: 0,
    status: 'complete' as const,
  })),
}

/** No working code: the publication would be refused. */
export const REVIEW_BLOCKED: PortalReview = {
  ...REVIEW_LIVE_WITH_CHANGES,
  canPublish: false,
  checks: [
    { code: 'public_address', status: 'blocked', locale: null, keys: [] },
    ...ALL_PASSED.filter((check) => check.code !== 'public_address'),
  ],
  checkCounts: { blocked: 1, warning: 0, passed: 6 },
}

/** The live page already says what the draft says. */
export const REVIEW_NOTHING_TO_PUBLISH: PortalReview = {
  ...REVIEW_ALL_CLEAR,
  nothingToPublish: true,
  canPublish: false,
  publishesAsVersion: 6,
  changes: [],
}

/** A portal that is not live yet: no change list, and its first version. */
export const REVIEW_FIRST_PUBLICATION: PortalReview = {
  ...REVIEW_ALL_CLEAR,
  publicationState: 'draft',
  action: 'publish',
  live: null,
  publishesAsVersion: 1,
  changes: [],
}

export const REVIEW_PEOPLE = [
  { userId: 'u-me', name: 'Eli Petrova' },
  { userId: 'u-georgi', name: 'Georgi Ivanov' },
] as const
