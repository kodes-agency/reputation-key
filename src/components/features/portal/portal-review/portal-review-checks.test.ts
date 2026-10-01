import { describe, expect, it } from 'vitest'
import type {
  MissingPortalText,
  ReviewCheck,
} from '#/contexts/portal/application/public-api'
import { phraseText } from '../portal-history/portal-history-phrase'
import {
  describeFixerLine,
  describeReviewCheck,
  summarizePassedChecks,
} from './portal-review-checks'

const check = (over: Partial<ReviewCheck> & Pick<ReviewCheck, 'code' | 'status'>) =>
  ({ locale: null, keys: [], ...over }) satisfies ReviewCheck

const linkLabel = (linkId: string, label: string | null): MissingPortalText => ({
  key: `link:${linkId}`,
  kind: 'link_label',
  linkId,
  linkLabel: label,
  blocksPublish: false,
})

const described = (
  input: ReviewCheck,
  missing: ReadonlyArray<MissingPortalText> = [],
  fallbackLocale: 'en' | 'bg' = 'en',
) => {
  const line = describeReviewCheck(input, { missing, fallbackLocale })
  return {
    ...line,
    title: phraseText(line.title),
    detail: line.detail === null ? null : phraseText(line.detail),
  }
}

describe('describeReviewCheck: warnings', () => {
  it('says what one missing link label means for that language’s guests', () => {
    const line = described(
      check({ code: 'copied_text', status: 'warning', locale: 'de', keys: ['link:a1'] }),
      [linkLabel('a1', 'Olive Terrace menu')],
    )

    expect(line).toMatchObject({
      status: 'warning',
      title: 'Deutsch · 1 label missing.',
      detail: 'German guests see ‘Olive Terrace menu’ in English.',
      note: 'You can publish without it.',
    })
  })

  it('counts several kinds of text together and names the first few', () => {
    const line = described(
      check({
        code: 'copied_text',
        status: 'warning',
        locale: 'es',
        keys: ['title', 'shortDescription'],
      }),
    )

    expect(line.title).toBe('Español · 2 texts missing.')
    expect(line.detail).toBe(
      'Spanish guests see the title and the description in English.',
    )
  })

  it('does not list every text when many are missing', () => {
    const keys = ['link:a', 'link:b', 'link:c', 'link:d'] as const
    const line = described(
      check({ code: 'copied_text', status: 'warning', locale: 'it', keys: [...keys] }),
      keys.map((key) => linkLabel(key.slice(5), key.slice(5).toUpperCase())),
    )

    expect(line.title).toBe('Italiano · 4 labels missing.')
    expect(line.detail).toBe('Italian guests see 4 labels in English.')
  })

  it('falls back to a plain word for a link label it cannot name', () => {
    const line = described(
      check({
        code: 'copied_text',
        status: 'warning',
        locale: 'de',
        keys: ['link:gone'],
      }),
    )

    expect(line.detail).toBe('German guests see a link label in English.')
  })

  it('names the fallback language the guests read instead', () => {
    const line = described(
      check({ code: 'copied_text', status: 'warning', locale: 'en', keys: ['title'] }),
      [],
      'bg',
    )

    expect(line.detail).toBe('English guests see the title in Bulgarian.')
  })
})

describe('describeReviewCheck: blocked', () => {
  it('says what publishing needs in the fallback language', () => {
    const line = described(
      check({
        code: 'primary_text',
        status: 'blocked',
        locale: 'en',
        keys: ['title', 'link:a1'],
      }),
      [linkLabel('a1', 'Spa')],
    )

    expect(line).toMatchObject({
      status: 'blocked',
      title: 'English · 2 texts missing.',
      detail: 'Publishing needs the title and the label for ‘Spa’ in English.',
      note: null,
    })
  })

  it('points a missing title at the welcome section, and a missing link label at the Linktree', () => {
    const title = describeReviewCheck(
      check({ code: 'primary_text', status: 'blocked', locale: 'en', keys: ['title'] }),
      { missing: [], fallbackLocale: 'en' },
    )
    const label = describeReviewCheck(
      check({ code: 'primary_text', status: 'blocked', locale: 'en', keys: ['link:a1'] }),
      { missing: [], fallbackLocale: 'en' },
    )

    expect(title.fix).toEqual({ tab: 'page', section: 'welcome' })
    expect(label.fix).toEqual({ tab: 'page', section: 'linktree' })
  })

  it('names each gate and where it is fixed', () => {
    expect(
      described(check({ code: 'responsible_manager', status: 'blocked' })),
    ).toMatchObject({
      title: 'No one is responsible for this portal',
      fix: { tab: 'page', section: 'responsible' },
    })
    expect(described(check({ code: 'public_address', status: 'blocked' }))).toMatchObject(
      {
        title: 'No working code',
        fix: { tab: 'share' },
      },
    )
    expect(
      described(check({ code: 'google_destination', status: 'blocked' })),
    ).toMatchObject({ title: 'No verified Google link', fix: null })
    expect(
      described(check({ code: 'property_available', status: 'blocked' })),
    ).toMatchObject({ title: 'The property is unavailable', fix: null })
    expect(described(check({ code: 'time_zone', status: 'blocked' }))).toMatchObject({
      title: 'The property’s time zone is not valid',
      fix: null,
    })
  })

  it('says a language with no guest wording yet cannot be published, and points at Languages', () => {
    expect(
      described(check({ code: 'language_packs', status: 'blocked', locale: 'fr' })),
    ).toMatchObject({
      title: 'Français has no guest wording yet',
      detail: 'Remove it from the portal’s languages to publish.',
      fix: { tab: 'page', section: 'languages' },
    })
  })
})

describe('describeReviewCheck: passed', () => {
  it('has a plain statement for each gate', () => {
    const titles = (
      [
        'property_available',
        'google_destination',
        'responsible_manager',
        'public_address',
        'primary_text',
        'language_packs',
        'time_zone',
      ] as const
    ).map((code) => described(check({ code, status: 'passed' })).title)

    expect(titles).toEqual([
      'The property is active',
      'Google link verified',
      'A manager is responsible',
      'The address works',
      'Every required text is written',
      'Every language is ready',
      'The property’s time zone is valid',
    ])
  })
})

describe('summarizePassedChecks', () => {
  const passed = (code: ReviewCheck['code']) => check({ code, status: 'passed' })

  it('counts the checks and names the first two', () => {
    const summary = summarizePassedChecks(
      [passed('google_destination'), passed('public_address'), passed('time_zone')].map(
        (c) => describeReviewCheck(c, { missing: [], fallbackLocale: 'en' }),
      ),
    )

    expect(summary).toBe(
      '3 checks passed · Google link verified, the address works and more',
    )
  })

  it('does not say "and more" when everything is named', () => {
    const summary = summarizePassedChecks(
      [passed('google_destination'), passed('public_address')].map((c) =>
        describeReviewCheck(c, { missing: [], fallbackLocale: 'en' }),
      ),
    )

    expect(summary).toBe('2 checks passed · Google link verified and the address works')
  })

  it('says one check passed in the singular and nothing for none', () => {
    expect(
      summarizePassedChecks([
        describeReviewCheck(passed('time_zone'), { missing: [], fallbackLocale: 'en' }),
      ]),
    ).toBe('1 check passed · the property’s time zone is valid')
    expect(summarizePassedChecks([])).toBeNull()
  })
})

describe('warnings point at the Languages section, where the gaps are listed', () => {
  it('has a fix for a copied text', () => {
    expect(
      described(
        check({ code: 'copied_text', status: 'warning', locale: 'de', keys: ['title'] }),
      ).fix,
    ).toEqual({ tab: 'page', section: 'languages' })
  })
})

describe('who fixes a check', () => {
  const fixerOf = (
    code: ReviewCheck['code'],
    status: ReviewCheck['status'] = 'blocked',
  ) =>
    describeReviewCheck(check({ code, status, locale: 'de', keys: ['title'] }), {
      missing: [],
      fallbackLocale: 'en',
    }).fixer

  it('leaves the portal-level checks to the portal’s managers', () => {
    for (const code of [
      'responsible_manager',
      'public_address',
      'primary_text',
      'language_packs',
    ] as const) {
      expect(fixerOf(code)).toBe('portal_managers')
    }
    expect(fixerOf('copied_text', 'warning')).toBe('portal_managers')
  })

  it('leaves the property-level gates to an account admin, whoever manages the portal', () => {
    for (const code of [
      'google_destination',
      'property_available',
      'time_zone',
    ] as const) {
      expect(fixerOf(code)).toBe('account_admin')
    }
  })

  it('has no fixer for a check that passed', () => {
    expect(fixerOf('google_destination', 'passed')).toBeNull()
  })
})

describe('describeFixerLine', () => {
  it('names the responsible managers for a portal-level check', () => {
    expect(describeFixerLine('portal_managers', 'you or Georgi Ivanov')).toBe(
      'Who can fix: you or Georgi Ivanov',
    )
    expect(describeFixerLine('portal_managers', null)).toBeNull()
  })

  it('never names the portal’s managers for a property-level gate', () => {
    expect(describeFixerLine('account_admin', 'you or Georgi Ivanov')).toBe(
      'An account admin can fix this',
    )
    expect(describeFixerLine('account_admin', null)).toBe('An account admin can fix this')
  })

  it('says nothing for a check that passed', () => {
    expect(describeFixerLine(null, 'you')).toBeNull()
  })
})
