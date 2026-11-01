// Portal context — saving the final kit's wording (2026-10-27): who may, what it
// refuses, what it stores, and whose Portal it reaches.

import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalPrintWordingRepo } from '#/shared/testing/in-memory-portal-print-wording-repo'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { savePortalPrintWordingInputSchema } from '../dto/portal-print-wording.dto'
import { savePortalPrintWording } from './save-portal-print-wording'

const SAVED_AT = new Date('2026-10-27T10:00:00.000Z')

const staffApi = (accessible: readonly string[] | null): StaffPublicApi =>
  ({
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
  }) as unknown as StaffPublicApi

function setup(
  options: Readonly<{
    enabled?: boolean
    accessible?: readonly string[] | null
    personal?: boolean
  }> = {},
) {
  const portal = buildTestPortal(
    options.personal
      ? { kind: 'personal', name: 'Polly Smith', publicName: 'Harbor' }
      : { name: 'Reception' },
  )
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const wordingRepo = createInMemoryPortalPrintWordingRepo()
  const save = savePortalPrintWording({
    portalRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    wordingRepo,
    clock: () => SAVED_AT,
    finalKitEnabled: options.enabled ?? true,
  })
  return { portal, save, wordingRepo }
}

/** The input as the server function hands it over: parsed by the DTO. */
const parsed = (input: unknown) => savePortalPrintWordingInputSchema.parse(input)

const ctx = buildTestAuthContext()
const OWN = { en: { headline: '  Thanks for\nstaying ', subline: 'Tell us more' } }

describe('savePortalPrintWording', () => {
  it('refuses a staff name in saved print wording without saving it', async () => {
    const { portal, save, wordingRepo } = setup({ personal: true })
    await expect(
      save(
        parsed({
          portalId: portal.id,
          callToAction: 'how_was_stay',
          customWords: { en: { headline: 'Ask Polly', subline: '' } },
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'personal_portal_name_private' })
    expect(wordingRepo.saved()).toEqual([])
  })
  it('saves the wording and the own words, normalised, as the Portal’s', async () => {
    const { portal, save, wordingRepo } = setup()

    const stored = await save(
      parsed({ portalId: portal.id, callToAction: 'how_was_stay', customWords: OWN }),
      ctx,
    )

    const wording = {
      callToAction: 'how_was_stay',
      customWords: { en: { headline: 'Thanks for staying', subline: 'Tell us more' } },
    }
    expect(stored).toEqual(wording)
    expect(wordingRepo.saved()).toEqual([
      {
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        wording,
        savedAt: SAVED_AT,
      },
    ])
  })

  it('keeps own words only where they differ from the wording’s copy, and none when none does', async () => {
    const { portal, save } = setup()

    const stored = await save(
      parsed({
        portalId: portal.id,
        callToAction: 'how_was_stay',
        customWords: {
          en: { headline: 'How was your stay?', subline: 'Share your experience' },
          bg: { headline: 'Благодарим', subline: '' },
        },
      }),
      ctx,
    )

    expect(stored).toEqual({
      callToAction: 'how_was_stay',
      customWords: { bg: { headline: 'Благодарим', subline: '' } },
    })
    const plain = await save(
      parsed({
        portalId: portal.id,
        callToAction: 'how_did_we_do',
        customWords: { en: { headline: 'How did we do?', subline: 'About 30 seconds' } },
      }),
      ctx,
    )
    expect(plain).toEqual({ callToAction: 'how_did_we_do', customWords: null })
  })

  it('saves a picked wording with no own words', async () => {
    const { portal, save, wordingRepo } = setup()

    await save(parsed({ portalId: portal.id, callToAction: 'rate_visit' }), ctx)

    expect(wordingRepo.saved()[0]?.wording).toEqual({
      callToAction: 'rate_visit',
      customWords: null,
    })
  })

  it('does not judge whether the words fit a print: that is the download’s', async () => {
    const { portal, save } = setup()
    const sixty = 'W'.repeat(60)

    await expect(
      save(
        parsed({
          portalId: portal.id,
          callToAction: 'how_did_we_do',
          customWords: { en: { headline: sixty, subline: sixty } },
        }),
        ctx,
      ),
    ).resolves.toMatchObject({ customWords: { en: { headline: sixty } } })
  })

  it('refuses own words that offer something for the review, as the download does', async () => {
    const { portal, save, wordingRepo } = setup()

    await expect(
      save(
        parsed({
          portalId: portal.id,
          callToAction: 'how_did_we_do',
          customWords: { en: { headline: 'Get 10% off', subline: '' } },
        }),
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      context: { cause: 'remove_offer' },
    })
    expect(wordingRepo.saved()).toEqual([])
  })

  it('refuses where the server has the final kit off', async () => {
    const { portal, save, wordingRepo } = setup({ enabled: false })

    await expect(
      save(parsed({ portalId: portal.id, callToAction: 'how_did_we_do' }), ctx),
    ).rejects.toMatchObject({ code: 'print_format_not_offered' })
    expect(wordingRepo.saved()).toEqual([])
  })

  it('refuses a caller who may not update the Portal', async () => {
    const { portal, save, wordingRepo } = setup()

    await expect(
      save(
        parsed({ portalId: portal.id, callToAction: 'how_did_we_do' }),
        buildTestAuthContext({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(wordingRepo.saved()).toEqual([])
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, save, wordingRepo } = setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })

    await expect(
      save(parsed({ portalId: portal.id, callToAction: 'how_did_we_do' }), ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(wordingRepo.saved()).toEqual([])
  })

  it('does not find a Portal of another Organization, and saves nothing for it', async () => {
    const { portal, save, wordingRepo } = setup()

    await expect(
      save(
        parsed({ portalId: portal.id, callToAction: 'how_did_we_do' }),
        buildTestAuthContext({ organizationId: organizationId('org-other') }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(wordingRepo.saved()).toEqual([])
  })
})

describe('savePortalPrintWordingInputSchema', () => {
  const base = { portalId: 'p-1', callToAction: 'how_did_we_do' }
  const parse = (input: object) => savePortalPrintWordingInputSchema.safeParse(input)

  it('takes every wording of the menu, and no other', () => {
    for (const callToAction of [
      'how_did_we_do',
      'how_was_visit',
      'how_was_stay',
      'rate_visit',
      'got_30_seconds',
    ]) {
      expect(parse({ ...base, callToAction }).success).toBe(true)
    }
    expect(parse({ ...base, callToAction: 'rate' }).success).toBe(false)
    expect(parse({ ...base, portalId: '' }).success).toBe(false)
  })

  it('holds own words to the download’s rules', () => {
    const words = (copy: object) => parse({ ...base, customWords: { en: copy } })
    expect(words({ headline: 'Hi', subline: '' }).success).toBe(true)
    expect(words({ headline: '', subline: '' }).success).toBe(false)
    expect(words({ headline: 'x'.repeat(61), subline: '' }).success).toBe(false)
    expect(words({ headline: 'Hi', subline: 'x'.repeat(61) }).success).toBe(false)
    expect(words({ headline: 'Hi\u0007', subline: '' }).success).toBe(false)
    expect(
      parse({ ...base, customWords: { xx: { headline: 'Hi', subline: '' } } }).success,
    ).toBe(false)
  })
})
