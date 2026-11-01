import { describe, expect, it } from 'vitest'
import { assertPersonalPortalPublicText } from './personal-portal-public-text'

describe('personal Portal public wording', () => {
  const portal = { kind: 'personal', name: 'Polly Smith' } as const
  it.each([
    'Polly Smith',
    'Ask POLLY',
    'Help from Smith',
    { en: { title: 'Polly', shortDescription: null } },
    { links: [{ texts: { en: { label: 'Smith', line: null } } }] },
  ])('refuses a name in public wording %j', (text) => {
    expect(() => assertPersonalPortalPublicText(portal, text)).toThrow(
      'Remove the staff name',
    )
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
