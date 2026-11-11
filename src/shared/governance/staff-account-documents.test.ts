import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const legalBody = (file: string) =>
  readFileSync(`docs/legal/${file}.md`, 'utf8')
    .split(/## (?:\d+\. )?Changes/u)[0]!
    .replace(/\s+/gu, ' ')

describe('current notice corrections', () => {
  it('explains unstored responses while preserving Google and limiting correction to stored responses', () => {
    const privacy = legalBody('privacy-notice')
    expect(privacy).toContain(
      'During an unusually busy period or abuse, a response may not be stored because a limit has been reached.',
    )
    expect(privacy).toContain(
      'The Guest still sees the normal thank-you and the same Google Review option, with the same order, timing, copy and prominence.',
    )
    expect(privacy).toContain(
      'If no response was stored, there is nothing to correct or withdraw and those options are unavailable.',
    )
    expect(privacy).toContain('For a stored response, a Guest may correct')
    expect(privacy).toContain('nothing to correct or withdraw')
  })

  it('discloses stored Reporting copies, current AI cleanup and inactive source deletion', () => {
    const privacy = legalBody('privacy-notice')
    expect(
      privacy.match(/The Service no longer records separate per-review star values/gu),
    ).toHaveLength(2)
    expect(privacy).toContain('per-review rating, review text and language')
    expect(privacy).toContain('a new successful fetch restarts that period')
    expect(privacy).toContain(
      'automatic deletion of the stored current source content is not active yet',
    )
    expect(privacy).toContain(
      'Database backups are deleted on a fixed schedule within 30 days: daily copies after six days and weekly copies after 27 days.',
    )
    expect(privacy).not.toContain(
      're-application of erasures after a restore is not active',
    )
    expect(privacy).not.toContain('can therefore bring back information erased')
    expect(privacy).toContain('except the stored business category')
    expect(privacy).toContain('expire after 730 days and are deleted by daily cleanup')
    expect(privacy).toContain('Operational Action History has no active deletion rule')
    expect(privacy).toContain(
      'Existing copies remain with no enforced expiry and are being removed.',
    )
    expect(privacy).not.toContain('These copies await removal.')
    expect(privacy).not.toContain('23,349')
    expect(privacy).not.toContain('365 days under the current engineering policy')
    expect(privacy).toContain(
      'The stored business category is cleared when Google is disconnected and when AI results are purged; no automatic retention rule removes it by age',
    )
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
      'Automatic deletion of expired current imported content is not active yet.',
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
    expect(agreement).toContain('Privacy Notice version 3.8, effective 2026-11-11')
    expect(agreement).toContain(
      'Google Business Profile Access Disclosure version 2.7, effective 2026-11-11',
    )
    expect(agreement).not.toContain('docs/BETA.md')
    expect(agreement.match(/schedule (?:is )?maintained in/gu)).toHaveLength(2)
    expect(agreement).not.toContain('four feature switches')
    expect(agreement).not.toContain('Property Trends')
    expect(agreement).toContain('Recent Activity')
    expect(agreement).not.toContain('does not promise unavailable self-service export')
  })

  it('retires Property Trends from every published choice', () => {
    expect(legalBody('privacy-notice')).toContain(
      'Review Analysis and Reply Drafting are independent Property-level controlled capabilities. Neither becomes available merely because code exists.',
    )
    expect(legalBody('internal-beta-agreement')).toContain(
      'Review Analysis and Reply Drafting are independent, off-by-default Property capabilities.',
    )
    const disclosure = legalBody('google-access-disclosure')
    expect(disclosure).toContain(
      'Review Analysis and Reply Drafting are separate controlled capabilities, each requiring its own permission.',
    )
    for (const file of [
      'privacy-notice',
      'internal-beta-agreement',
      'google-access-disclosure',
    ]) {
      expect(legalBody(file)).not.toContain('Property Trends')
      expect(legalBody(file)).not.toContain('three independent')
    }
  })

  it('publishes the business category clearing promise', () => {
    expect(legalBody('privacy-notice')).toContain(
      'The category is used as AI context and to pick example words, is shown during Google import, and is removed when Google is disconnected.',
    )
  })

  it('publishes the erasure record and restore replay only where main writes and replays it', () => {
    const privacy = legalBody('privacy-notice')
    expect(privacy).toContain(
      'Before an approved erasure request or a one-off purge deletes information, the Service saves a separate record containing only the identifiers needed to repeat that erasure after a restore. These records are kept in separate object storage for 45 days. If saving the record fails, the erasure waits and Reputation Key is alerted. After a restore, the records are used to repeat those erasures before the restored Service returns to use. Routine deletion of information that has reached its age limit runs again after a restore and needs no separate erasure record.',
    )
    expect(privacy).toContain(
      'A guest withdrawal does not yet save such a record, so restoring an older backup can bring back a response a guest withdrew after that backup was made.',
    )
    expect(privacy).not.toContain('Before a guest withdrawal deletes information')
    expect(privacy).toContain(
      'confirmed erasure with a record that allows it to be repeated after a restore.',
    )
    expect(legalBody('internal-beta-agreement')).toContain(
      'A separate erasure record allows deletion to be repeated after a restore.',
    )
  })

  it('explains how All Time totals are calculated', () => {
    expect(legalBody('privacy-notice')).toContain(
      'Portal “All Time” totals are calculated from the retained Guest metric readings. Those readings have a 24-month retention limit. Once older readings start to expire, the totals cover the last 24 months and will be labelled “last 24 months”, rather than “All Time”.',
    )
  })

  it('describes the manual export, closure and rights procedure', () => {
    const privacy = legalBody('privacy-notice')
    const delivery =
      'a 24-hour download link to a file in the private bucket, deleted after download and after seven days at the latest, never an email attachment'
    expect(privacy).toContain(
      `Organization exports prepared through the manual procedure | Provided on request within seven days from verified identity; ${delivery}`,
    )
    expect(privacy).not.toContain('Organization Export object')
    expect(privacy).not.toContain('single-use retrieval authority')
    expect(privacy).not.toContain('Organization Export objects are kept')
    expect(privacy).not.toContain('purged by the Organization closure workflow')
    expect(privacy).toContain(
      'purged through Reputation Key’s manual Organization closure procedure',
    )
    expect(privacy).toContain(
      'Organization exports, closure, permanent Property erasure and privacy requests are handled by the owner through the operator script, not through self-service account controls.',
    )
    expect(privacy).toContain('Reputation Key responds within 30 days.')
    expect(privacy).toContain(
      'We answer within 30 days and provide an export on request within seven days from verified identity.',
    )
    expect(privacy).toContain(
      'Permanent Property erasure must be requested by an AccountAdmin.',
    )
    const agreement = legalBody('internal-beta-agreement')
    expect(agreement).toContain(
      'Permanent Property erasure is requested by an AccountAdmin and handled by the Operator.',
    )
    expect(agreement).toContain(
      'Self-service Organization export, closure and permanent Property erasure are unavailable.',
    )
    expect(agreement).not.toContain('single-use retrieval authority')
    expect(agreement).not.toContain('17-context workflow')
    expect(agreement).toContain(
      delivery.replace('never an email attachment', 'never as an email attachment'),
    )
  })
})

describe('staff account release documents', () => {
  it.each([
    ['privacy-notice', '3.8'],
    ['internal-beta-agreement', '2.9'],
    ['google-access-disclosure', '2.7'],
  ])('publishes %s version %s on the approved release date', (file, version) => {
    const text = readFileSync(`docs/legal/${file}.md`, 'utf8')
    expect(text).toContain(`**Version:** ${version}`)
    expect(text).toContain('**Effective date:** 2026-11-11')
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
      expect(text).toContain('amended_on: 2026-11-11')
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
