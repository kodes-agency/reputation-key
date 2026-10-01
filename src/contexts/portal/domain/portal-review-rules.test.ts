import { describe, expect, it } from 'vitest'
import {
  buildReviewChanges,
  evaluateReviewChecks,
  reviewLanguageRows,
  type ReviewEditInput,
  type ReviewReadiness,
} from './portal-review-rules'
import type { PortalLanguageCoverage } from './portal-language-coverage'

const READY: ReviewReadiness = {
  propertyActive: true,
  googleDestinationVerified: true,
  hasResponsibleManager: true,
  hasPublicAddress: true,
  blockers: [],
  warnings: [],
}

const codes = (checks: ReadonlyArray<{ code: string; status: string }>) =>
  checks.map((check) => `${check.status}:${check.code}`)

describe('evaluateReviewChecks', () => {
  it('passes every check for a Portal that is ready', () => {
    const result = evaluateReviewChecks(READY)

    expect(result.canPublish).toBe(true)
    expect(result.blockedCount).toBe(0)
    expect(result.warningCount).toBe(0)
    expect(result.passedCount).toBe(7)
    expect(codes(result.checks)).toEqual([
      'passed:property_available',
      'passed:google_destination',
      'passed:responsible_manager',
      'passed:public_address',
      'passed:primary_text',
      'passed:language_packs',
      'passed:time_zone',
    ])
  })

  it('blocks on each readiness gate the publish use case refuses', () => {
    const result = evaluateReviewChecks({
      ...READY,
      propertyActive: false,
      googleDestinationVerified: false,
      hasResponsibleManager: false,
      hasPublicAddress: false,
    })

    expect(result.canPublish).toBe(false)
    expect(result.blockedCount).toBe(4)
    expect(codes(result.checks).slice(0, 4)).toEqual([
      'blocked:property_available',
      'blocked:google_destination',
      'blocked:responsible_manager',
      'blocked:public_address',
    ])
  })

  it('groups missing primary-language texts into one blocked check per language', () => {
    const result = evaluateReviewChecks({
      ...READY,
      blockers: [
        { code: 'primary_text_missing', locale: 'en', key: 'title' },
        { code: 'primary_text_missing', locale: 'en', key: 'link:abc' },
      ],
    })

    expect(result.canPublish).toBe(false)
    const missing = result.checks.find((check) => check.code === 'primary_text')
    expect(missing).toEqual({
      code: 'primary_text',
      status: 'blocked',
      locale: 'en',
      keys: ['title', 'link:abc'],
    })
    expect(result.checks.filter((check) => check.code === 'primary_text')).toHaveLength(1)
  })

  it('blocks on a language with no copy pack and on an unusable time zone', () => {
    const result = evaluateReviewChecks({
      ...READY,
      blockers: [
        { code: 'language_pack_missing', locale: 'de' },
        { code: 'time_zone_invalid' },
      ],
    })

    expect(result.canPublish).toBe(false)
    expect(result.checks).toContainEqual({
      code: 'language_packs',
      status: 'blocked',
      locale: 'de',
      keys: [],
    })
    expect(result.checks).toContainEqual({
      code: 'time_zone',
      status: 'blocked',
      locale: null,
      keys: [],
    })
  })

  it('reports copied texts as a warning that does not block publishing', () => {
    const result = evaluateReviewChecks({
      ...READY,
      warnings: [
        { code: 'text_copied_from_primary', locale: 'de', key: 'link:abc' },
        { code: 'text_copied_from_primary', locale: 'de', key: 'shortDescription' },
        { code: 'text_copied_from_primary', locale: 'es', key: 'title' },
      ],
    })

    expect(result.canPublish).toBe(true)
    expect(result.warningCount).toBe(2)
    expect(result.checks.filter((check) => check.status === 'warning')).toEqual([
      {
        code: 'copied_text',
        status: 'warning',
        locale: 'de',
        keys: ['link:abc', 'shortDescription'],
      },
      { code: 'copied_text', status: 'warning', locale: 'es', keys: ['title'] },
    ])
  })

  it('lists blocked checks first, then warnings, then the ones that passed', () => {
    const result = evaluateReviewChecks({
      ...READY,
      hasPublicAddress: false,
      warnings: [{ code: 'text_copied_from_primary', locale: 'de', key: 'title' }],
    })

    expect(result.checks.map((check) => check.status)).toEqual([
      'blocked',
      'warning',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(result.passedCount).toBe(6)
  })
})

const NOW = new Date('2026-09-30T12:00:00.000Z')
const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
const LINK = '11111111-1111-4111-8111-111111111111'
const OTHER_LINK = '22222222-2222-4222-8222-222222222222'

const edit = (overrides: Partial<ReviewEditInput>): ReviewEditInput => ({
  kind: 'portal_links',
  key: `link:${LINK}:updated`,
  propertyWide: false,
  actorUserId: 'georgi',
  occurredAt: at(60),
  previousText: null,
  newText: null,
  editCount: 1,
  ...overrides,
})

const base = {
  edits: [] as readonly ReviewEditInput[],
  pending: [] as ReadonlyArray<{
    kind: ReviewEditInput['kind']
    changedBy: string | null
    changedAt: Date
  }>,
  liveIsEarlierDesign: false,
  destinationMoved: false,
  workingCopyDiffers: false,
}

describe('buildReviewChanges', () => {
  it('lists nothing when nothing changed', () => {
    expect(buildReviewChanges(base)).toEqual([])
  })

  it('lists edits oldest first, each with its person, time and subject', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      edits: [
        edit({
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          actorUserId: 'elena',
          occurredAt: at(120),
          previousText: 'Zona de piscina',
          newText: 'Piscina y terraza',
        }),
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(24 * 60),
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
        }),
      ],
    })

    expect(changes).toEqual([
      {
        type: 'edit',
        kind: 'portal_links',
        key: `link:${LINK}:text:en`,
        subject: { area: 'link_text', linkId: LINK, locale: 'en' },
        propertyWide: false,
        actorUserId: 'georgi',
        occurredAt: at(24 * 60),
        previousText: 'Dinner menu',
        newText: 'Olive Terrace menu',
        editCount: 1,
      },
      {
        type: 'edit',
        kind: 'property_brand_content',
        key: 'es',
        subject: { area: 'welcome_text', locale: 'es' },
        propertyWide: true,
        actorUserId: 'elena',
        occurredAt: at(120),
        previousText: 'Zona de piscina',
        newText: 'Piscina y terraza',
        editCount: 1,
      },
    ])
  })

  it('folds several saves of one part into one change from the first wording to the last', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      edits: [
        edit({
          key: 'settings:name',
          kind: 'portal_configuration',
          occurredAt: at(10),
          previousText: 'Pool',
          newText: 'Pool & Terrace',
          actorUserId: 'elena',
          editCount: 2,
        }),
        edit({
          key: 'settings:name',
          kind: 'portal_configuration',
          occurredAt: at(300),
          previousText: 'Pool bar',
          newText: 'Pool',
          actorUserId: 'georgi',
          editCount: 3,
        }),
      ],
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      type: 'edit',
      previousText: 'Pool bar',
      newText: 'Pool & Terrace',
      actorUserId: 'elena',
      occurredAt: at(10),
      editCount: 5,
    })
  })

  it('drops a wording change that was put back to what is live', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: false,
      pending: [{ kind: 'portal_links', changedBy: 'georgi', changedAt: at(5) }],
      edits: [
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(30),
          previousText: 'Dinner menu',
          newText: 'Menu',
        }),
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(5),
          previousText: 'Menu',
          newText: 'Dinner menu',
        }),
      ],
    })

    // The fence is still open but the draft says what is live: the edit cancels
    // out, and the page says publishing changes nothing guests see.
    expect(changes).toEqual([{ type: 'no_visible_change' }])
  })

  it('drops a text that was added and then cleared again', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: false,
      edits: [
        edit({
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          occurredAt: at(30),
          previousText: null,
          newText: 'Piscina',
        }),
        edit({
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          occurredAt: at(5),
          previousText: 'Piscina',
          newText: null,
        }),
      ],
    })

    expect(changes).toEqual([])
  })

  it('keeps a link update that carries no wording, even when folded', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      edits: [edit({ key: `link:${LINK}:updated`, editCount: 2 })],
    })

    expect(changes).toHaveLength(1)
  })

  it('lists a pre-existing tile that was edited and then deleted once, as the deletion', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      edits: [
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(50),
          previousText: 'Spa',
          newText: 'Spa & treatments',
        }),
        edit({ key: `link:${LINK}:updated`, occurredAt: at(45) }),
        edit({
          key: `link:${LINK}:deleted`,
          occurredAt: at(30),
          previousText: 'Spa & treatments',
        }),
      ],
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      subject: { area: 'link', linkId: LINK, change: 'deleted' },
    })
  })

  it('does not list a tile that was added and removed in the same draft', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: false,
      edits: [
        edit({ key: `link:${LINK}:created`, occurredAt: at(50), newText: 'Spa' }),
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(40),
          newText: 'Spa & treatments',
        }),
        edit({ key: `link:${LINK}:deleted`, occurredAt: at(30), previousText: 'Spa' }),
        edit({ key: `link:${OTHER_LINK}:updated`, occurredAt: at(20) }),
      ],
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      type: 'edit',
      subject: { area: 'link', linkId: OTHER_LINK, change: 'updated' },
    })
  })

  it('lists a new tile once, without the edits made to it afterwards', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      edits: [
        edit({ key: `link:${LINK}:created`, occurredAt: at(50), newText: 'Spa' }),
        edit({
          key: `link:${LINK}:text:en`,
          occurredAt: at(40),
          newText: 'Spa & treatments',
        }),
        edit({ key: `link:${LINK}:updated`, occurredAt: at(35) }),
      ],
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      subject: { area: 'link', linkId: LINK, change: 'created' },
      newText: 'Spa & treatments',
    })
  })

  it('names a recorded change that has no ledger row, with who made it last', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      pending: [
        { kind: 'approved_destination', changedBy: 'elena', changedAt: at(15) },
        { kind: 'approved_destination', changedBy: null, changedAt: at(90) },
      ],
    })

    expect(changes).toEqual([
      {
        type: 'unrecorded',
        kind: 'approved_destination',
        actorUserId: 'elena',
        occurredAt: at(15),
      },
    ])
  })

  it('does not repeat a fence kind the ledger already explains', () => {
    const changes = buildReviewChanges({
      ...base,
      workingCopyDiffers: true,
      pending: [{ kind: 'portal_links', changedBy: 'georgi', changedAt: at(60) }],
      edits: [edit({ key: `link:${LINK}:updated` })],
    })

    expect(changes.map((change) => change.type)).toEqual(['edit'])
  })

  it('leads with the move off the earlier design and the Google address move', () => {
    const changes = buildReviewChanges({
      ...base,
      liveIsEarlierDesign: true,
      destinationMoved: true,
      workingCopyDiffers: true,
      edits: [edit({ key: `link:${LINK}:updated` })],
    })

    expect(changes.map((change) => change.type)).toEqual([
      'earlier_design',
      'google_destination_moved',
      'edit',
    ])
  })

  it('says something is unlisted when the draft differs but nothing nameable was recorded', () => {
    expect(buildReviewChanges({ ...base, workingCopyDiffers: true })).toEqual([
      { type: 'unlisted' },
    ])
  })
})

describe('reviewLanguageRows', () => {
  const coverage: PortalLanguageCoverage = {
    portalId: 'portal-1',
    fallbackLocale: 'en',
    missingTotal: 2,
    languages: [
      { locale: 'en', isFallback: true, total: 14, present: 14, missing: [] },
      {
        locale: 'de',
        isFallback: false,
        total: 14,
        present: 13,
        missing: [
          {
            key: 'link:abc',
            kind: 'link_label',
            linkId: 'abc',
            linkLabel: 'Olive Terrace menu',
            blocksPublish: false,
          },
        ],
      },
      {
        locale: 'es',
        isFallback: false,
        total: 14,
        present: 14,
        missing: [],
      },
    ],
  }

  it('says whether each language is complete, copied from the fallback, or blocking', () => {
    const rows = reviewLanguageRows(coverage, { es: 2 })

    expect(rows).toEqual([
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
        locale: 'de',
        isFallback: false,
        total: 14,
        present: 13,
        missingCount: 1,
        missing: [
          {
            key: 'link:abc',
            kind: 'link_label',
            linkId: 'abc',
            linkLabel: 'Olive Terrace menu',
            blocksPublish: false,
          },
        ],
        status: 'copied_from_fallback',
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
    ])
  })

  it('marks a gap in the fallback language as blocking', () => {
    const [first] = reviewLanguageRows(
      {
        ...coverage,
        languages: [
          {
            locale: 'en',
            isFallback: true,
            total: 14,
            present: 13,
            missing: [
              {
                key: 'title',
                kind: 'title',
                linkId: null,
                linkLabel: null,
                blocksPublish: true,
              },
            ],
          },
        ],
      },
      {},
    )

    expect(first).toMatchObject({ status: 'blocked', missingCount: 1 })
  })
})
