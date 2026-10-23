import { describe, expect, it } from 'vitest'
import { PRINT_HOST_MAX_LENGTH, printOriginProblem } from './print-origin'

describe('printOriginProblem', () => {
  it.each([
    ['the beta print host', 'https://ap.up.railway.app'],
    ['the same with its trailing slash', 'https://ap.up.railway.app/'],
    ['a host of exactly the limit', `https://${'a'.repeat(PRINT_HOST_MAX_LENGTH)}`],
    ['a loopback origin with a port', 'http://127.0.0.1:3000'],
    ['an upper-case host, which a URL folds', 'https://AP.UP.RAILWAY.APP'],
    ['a default port, which a URL drops', 'https://ap.up.railway.app:443'],
  ])('accepts %s', (_label, value) => {
    expect(printOriginProblem(value)).toBeUndefined()
  })

  it('names the limit when the host is longer than a version 3 symbol allows', () => {
    // 26 characters is the first host that pushes the 20-character code's QR
    // address to version 4 (ADR 0069), and a printed card cannot be redrawn.
    const problem = printOriginProblem(`https://${'a'.repeat(PRINT_HOST_MAX_LENGTH + 1)}`)

    expect(problem).toMatch(/at most 25 characters/)
  })

  it('counts the port, because the QR address carries it', () => {
    // A 22-character host plus ":8443" is 27 characters of address.
    expect(printOriginProblem(`https://${'a'.repeat(22)}:8443`)).toMatch(
      /at most 25 characters/,
    )
  })

  it.each([
    ['text that is not a URL', 'ap.up.railway.app'],
    ['an empty value', ''],
    ['another scheme', 'ftp://ap.up.railway.app'],
    ['a path', 'https://ap.up.railway.app/p'],
    ['a path under a slash', 'https://ap.up.railway.app/x/'],
    ['a query', 'https://ap.up.railway.app?x=1'],
    ['an empty query', 'https://ap.up.railway.app/?'],
    ['a fragment', 'https://ap.up.railway.app/#x'],
    ['an empty fragment', 'https://ap.up.railway.app/#'],
    ['credentials', 'https://user:pass@ap.up.railway.app'],
    ['a user name alone', 'https://user@ap.up.railway.app'],
  ])('refuses %s', (_label, value) => {
    expect(printOriginProblem(value)).toBeTypeOf('string')
  })

  it('never repeats the value, which may carry something that was pasted by mistake', () => {
    const problem = printOriginProblem('https://user:hunter2@ap.up.railway.app')

    expect(problem).not.toContain('hunter2')
  })
})
