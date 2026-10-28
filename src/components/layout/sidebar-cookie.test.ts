import { describe, expect, it } from 'vitest'
import { sidebarCookie, sidebarOpenFromCookie } from './sidebar-cookie'

describe('sidebarOpenFromCookie', () => {
  it('reads an open and a collapsed sidebar', () => {
    expect(sidebarOpenFromCookie('sidebar_state=true')).toBe(true)
    expect(sidebarOpenFromCookie('sidebar_state=false')).toBe(false)
  })

  it('finds the cookie among others', () => {
    expect(
      sidebarOpenFromCookie('rk_viewport=1440; sidebar_state=false; theme=dark'),
    ).toBe(false)
  })

  it('says nothing when there is no cookie', () => {
    expect(sidebarOpenFromCookie(undefined)).toBeNull()
    expect(sidebarOpenFromCookie(null)).toBeNull()
    expect(sidebarOpenFromCookie('')).toBeNull()
    expect(sidebarOpenFromCookie('rk_viewport=1440')).toBeNull()
  })

  it.each(['', 'garbage', 'TRUE', '1', '0', 'true false'])(
    'ignores a value that is not exactly true or false (%j)',
    (value) => {
      expect(sidebarOpenFromCookie(`sidebar_state=${value}`)).toBeNull()
    },
  )

  it('does not mistake a cookie whose name only ends the same way', () => {
    expect(sidebarOpenFromCookie('not_sidebar_state=false')).toBeNull()
  })
})

describe('sidebarCookie', () => {
  it('keeps the choice for a year, site-wide', () => {
    expect(sidebarCookie(false, false)).toBe(
      'sidebar_state=false; Path=/; Max-Age=31536000; SameSite=Lax',
    )
  })

  it('is Secure over https and only then', () => {
    expect(sidebarCookie(true, true)).toBe(
      'sidebar_state=true; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    )
    expect(sidebarCookie(true, false)).not.toContain('Secure')
  })

  it('round-trips through the reader', () => {
    expect(sidebarOpenFromCookie(sidebarCookie(false, true).split(';')[0])).toBe(false)
  })
})
