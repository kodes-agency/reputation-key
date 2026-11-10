import { describe, expect, it } from 'vitest'
import {
  assertPersonalPortalPublicText,
  withoutInheritedBrand,
} from './personal-portal-public-text'

describe('personal Portal public wording', () => {
  it.each([
    [
      'Sofia Petrova',
      { timezone: 'Europe/Sofia', wording: { en: { title: 'Your visit' } } },
    ],
    [
      'Joe Brown',
      {
        look: { displayName: "Joe's Barbershop" },
        wording: { en: { title: 'Your visit' } },
      },
    ],
    ['John A. Smith', { wording: { en: { title: 'Leave a review' } } }],
    ['Maria de la Cruz', { wording: { es: { title: 'Cuéntanos de la visita' } } }],
  ])(
    'allows legitimate name %s without matching structural or common words',
    (name, source) => {
      expect(() =>
        assertPersonalPortalPublicText({ kind: 'personal', name: String(name) }, source),
      ).not.toThrow()
    },
  )
  const portal = { kind: 'personal', name: 'Polly Smith' } as const
  it.each([
    'Polly Smith',
    'Ask POLLY',
    'Help from Smith',
    { look: { wordmark: 'POLLY' } },
    { brandProfile: { wordmark: 'Smith' } },
    { en: { title: 'Polly', shortDescription: null } },
    { links: [{ texts: { en: { label: 'Smith', line: null } } }] },
  ])('refuses a name in public wording %j', (text) => {
    expect(() => assertPersonalPortalPublicText(portal, text)).toThrow(
      'Remove the staff name',
    )
  })
  it('leaves the inherited Property brand wordmark out of the check', () => {
    const marco = { kind: 'personal', name: 'Marco Rossi' } as const
    const published = {
      look: { wordmark: 'Pizzeria Marco' },
      brandProfile: { wordmark: 'Pizzeria Marco' },
      wording: { en: { title: 'Your visit' } },
    }
    expect(() =>
      assertPersonalPortalPublicText(marco, withoutInheritedBrand(published, 'property')),
    ).not.toThrow()
    expect(() =>
      assertPersonalPortalPublicText(marco, withoutInheritedBrand(published, 'portal')),
    ).toThrow('Remove the staff name')
  })
  it('keeps the check on the Portal own wording when the brand is inherited', () => {
    expect(() =>
      assertPersonalPortalPublicText(
        { kind: 'personal', name: 'Marco Rossi' },
        withoutInheritedBrand(
          {
            look: { wordmark: 'Pizzeria Marco' },
            wording: { en: { title: 'Ask Marco' } },
          },
          'property',
        ),
      ),
    ).toThrow('Remove the staff name')
  })
  it('allows neutral wording and leaves place Portals unrestricted', () => {
    expect(() =>
      assertPersonalPortalPublicText(portal, {
        title: 'How was your visit?',
        links: [{ label: 'Our menu' }],
      }),
    ).not.toThrow()
    expect(() =>
      assertPersonalPortalPublicText({ ...portal, kind: 'place' }, 'Polly Smith'),
    ).not.toThrow()
  })
})
