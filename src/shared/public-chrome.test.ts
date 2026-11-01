import { describe, expect, it } from 'vitest'
import { showsPublicChrome } from './public-chrome'

describe('public site chrome', () => {
  it.each(['/my', '/_authenticated', '/p/$token'])('keeps %s in its own frame', (id) => {
    expect(showsPublicChrome(['__root__', id])).toBe(false)
  })
  it.each(['/login', '/privacy', '/join'])('keeps the public frame for %s', (id) => {
    expect(showsPublicChrome(['__root__', id])).toBe(true)
  })
})
