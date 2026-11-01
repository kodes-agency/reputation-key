import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('staff account release documents', () => {
  it.each([
    ['privacy-notice', '3.3'],
    ['internal-beta-agreement', '2.4'],
    ['google-access-disclosure', '2.4'],
  ])('publishes %s version %s on the approved release date', (file, version) => {
    const text = readFileSync(`docs/legal/${file}.md`, 'utf8')
    expect(text).toContain(`**Version:** ${version}`)
    expect(text).toContain('**Effective date:** 2026-11-03')
    expect(text).toContain('without a waiting period')
  })
  it('preserves the Google ban and states the staff scan target and manager Google selection plainly', () => {
    const text = readFileSync('docs/legal/google-access-disclosure.md', 'utf8')
    expect(text).toContain(
      '- using Google review solicitation, ratings, or review volume for competitive\n  staff goals, badges, rankings, or leaderboards; or',
    )
    expect(text.replace(/\s+/gu, ' ')).toContain(
      "A manager can set a target for Portal scans on a staff member's Portal, which that staff member sees; it counts scans only and uses no Google data, and managers can see how many guests selected the Google action on each staff member's Portal.",
    )
  })
  it('states staff visibility and the unenforced retention honestly', () => {
    const text = readFileSync('docs/legal/privacy-notice.md', 'utf8')
    expect(text).toContain('Guests never see a staff name.')
    expect(text).toContain('not enforced by code yet')
    expect(text).toContain('updated once a day')
    expect(text).toContain('24 months')
  })
})
