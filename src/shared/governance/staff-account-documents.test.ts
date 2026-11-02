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
    expect(text).toContain('**Effective date:** 2026-11-02')
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

it('discloses the marker, shared Group totals, report audiences and unenforced retention in their own sections', () => {
  const notice = readFileSync('docs/legal/privacy-notice.md', 'utf8').replace(
    /\s+/gu,
    ' ',
  )
  const section2 = notice.split('## 2.')[1]!.split('## 3.')[0]!
  const section4 = notice.split('## 4.')[1]!.split('## 5.')[0]!
  const section6 = notice.split('## 6.')[1]!.split('## 7.')[0]!
  for (const section of [section2, section4]) {
    expect(section).toContain('their scans are low compared with colleagues')
    expect(section).toContain('nothing happens automatically, and staff do not see it')
    expect(section).toContain('a live total that includes colleagues')
    expect(section).toContain(
      'the colleague list is on or the Group has at least three people',
    )
  }
  expect(section4).toContain(
    'Staff cannot see who gave a rating, but may notice their totals change',
  )
  expect(section4).toContain('Portal private feedback and Portal workflow notifications')
  expect(section6).toContain(
    "24-month retention for Reporting's readings of Guest facts is not enforced by code yet",
  )
  expect(section2).toContain('A Participant or Staff member may attach')
  expect(section2).toContain('browser of a Participant, Staff member or Guest')
  const agreement = readFileSync('docs/legal/internal-beta-agreement.md', 'utf8').replace(
    /\s+/gu,
    ' ',
  )
  expect(agreement.split('## 6.')[1]!.split('## 7.')[0]).toContain(
    'nothing happens automatically, and staff do not see it',
  )
})
