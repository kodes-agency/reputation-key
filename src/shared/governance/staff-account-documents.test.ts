import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const legalBody = (file: string) =>
  readFileSync(`docs/legal/${file}.md`, 'utf8')
    .split(/## (?:\d+\. )?Changes/u)[0]!
    .replace(/\s+/gu, ' ')

describe('current notice corrections', () => {
  it('discloses stored Reporting copies and inactive source deletion and erasure replay', () => {
    const privacy = legalBody('privacy-notice')
    expect(
      privacy.match(/Reporting currently holds 23,349 separate copies/gu),
    ).toHaveLength(2)
    expect(privacy).toContain('per-review rating, review text and language')
    expect(privacy).toContain('a new successful fetch restarts that period')
    expect(privacy).toContain(
      'automatic deletion of the stored content is not active yet',
    )
    expect(privacy).toContain(
      'Automatic recording and re-application of erasures after a restore is not active.',
    )
    expect(privacy).toContain(
      'Restoring an older backup can therefore bring back information erased after that backup was made.',
    )
    expect(privacy).toContain('except the stored business category')
    expect(privacy).not.toContain('The stored business category is cleared')
    expect(privacy).not.toContain('daily counts of reviews by star rating')
    expect(privacy).not.toContain('the answers kept for quality testing')
    expect(privacy).toContain(
      'Quality checks use an offline scorer on test material or answers already recorded. The scorer does not send reviews to an AI provider.',
    )
    expect(privacy).toContain('check the quality of AI analysis using an offline scorer')
  })

  it('states disconnect limits and the rehearsal evidence without publishing later safeguards', () => {
    const disclosure = legalBody('google-access-disclosure')
    expect(disclosure).toContain(
      'Disconnecting Google stops syncing and reply publication',
    )
    expect(disclosure).toContain('it deletes nothing on Google')
    expect(disclosure).toContain(
      'Automatic deletion of expired imported content is not active yet.',
    )
    expect(disclosure).toContain(
      'disconnection stops new Google work and does not itself erase imported content',
    )
    const agreement = legalBody('internal-beta-agreement')
    expect(agreement).toContain(
      'A restore into an isolated database was rehearsed on 2026-11-04.',
    )
    expect(agreement).toContain(
      'Erasure replay was not tested, and the app’s restore verifier was not used.',
    )
    expect(agreement).toContain('Privacy Notice version 3.5, effective 2026-11-06')
    expect(agreement).toContain(
      'Google Business Profile Access Disclosure version 2.5, effective 2026-11-06',
    )
    expect(agreement).not.toContain('docs/BETA.md')
    expect(agreement.match(/schedule (?:is )?maintained in/gu)).toHaveLength(2)
    expect(agreement).not.toContain('four feature switches')
    expect(agreement).toContain('Property Trends')
    expect(agreement).toContain('Recent Activity')
    expect(agreement).toContain(
      'does not promise unavailable self-service export or deletion',
    )
  })
})

describe('staff account release documents', () => {
  it.each([
    ['privacy-notice', '3.5'],
    ['internal-beta-agreement', '2.6'],
    ['google-access-disclosure', '2.5'],
  ])('publishes %s version %s on the approved release date', (file, version) => {
    const text = readFileSync(`docs/legal/${file}.md`, 'utf8')
    expect(text).toContain(`**Version:** ${version}`)
    expect(text).toContain('**Effective date:** 2026-11-06')
    expect(text).toContain('without a waiting period')
  })
  it.each(['privacy-notice', 'internal-beta-agreement'])(
    '%s discloses the no-scans marker in its body and dates the amendment',
    (file) => {
      const text = readFileSync(`docs/legal/${file}.md`, 'utf8')
      const [body] = text.replace(/\s+/gu, ' ').split(/## \d+\. Changes/u)
      expect(body).toContain(
        'Managers may also see a marker when someone who has joined has had no scans for 14 days. It prompts a conversation; nothing happens automatically, and staff do not see it.',
      )
      expect(text).toContain('amended_on: 2026-11-06')
    },
  )
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
