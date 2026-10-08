// The language of the unavailable page is read from the request alone. These
// checks are on the source, like the other public server functions' (see
// `public.test.ts`): the point is what the function does not touch.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./unavailable-locale.ts', import.meta.url), 'utf8')
const code = source.replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '')

describe('getUnavailableGuestLocale', () => {
  it('is a GET that answers with the language the browser asks for', () => {
    expect(code).toContain("createServerFn({ method: 'GET' })")
    expect(code).toContain("headers.get('accept-language')")
    expect(code).toContain('preferredGuestLocale(')
  })

  it('takes no token and reads no portal, so it can say nothing about one', () => {
    expect(code).not.toMatch(
      /token|getPublicPortal|guestPublicApi|getContainer|decidePublicExecution/iu,
    )
  })

  it('is private and never cached, and varies on the language it read', () => {
    expect(code).toContain('applyGuestPublicResponsePrivacy({ varyCookie: false })')
    expect(code).toContain("setResponseHeader('Vary', 'Accept-Language')")
    const privacy = code.indexOf('applyGuestPublicResponsePrivacy({ varyCookie: false })')
    expect(privacy).toBeLessThan(code.indexOf("headers.get('accept-language')"))
  })

  it('validates its input through the guest validator like the other public functions', () => {
    expect(code).toContain('guestPublicResponseValidator(')
  })
})
