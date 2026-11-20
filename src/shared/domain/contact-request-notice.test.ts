import { describe, expect, it } from 'vitest'
import {
  CONTACT_REQUEST_NOTICES_IN_FORCE,
  contactNoticeEvidenceFor,
  type ContactRequestNotice,
} from './contact-request-notice'

const NOTICE: ContactRequestNotice = {
  noticeId: 'privacy-notice',
  noticeVersion: '4.0',
  noticeDigest: 'a'.repeat(64),
  locales: ['en', 'bg'],
}

describe('contactNoticeEvidenceFor', () => {
  it('has no evidence while no notice in force covers contact requests', () => {
    expect(CONTACT_REQUEST_NOTICES_IN_FORCE).toEqual([])
    expect(contactNoticeEvidenceFor('en')).toBeNull()
  })

  it('pins the notice in the Portal’s language when the notice has it', () => {
    expect(contactNoticeEvidenceFor('bg', [NOTICE])).toEqual({
      noticeId: 'privacy-notice',
      noticeVersion: '4.0',
      noticeDigest: 'a'.repeat(64),
      noticeLocale: 'bg',
    })
  })

  it('falls back to the notice’s first language for a language it lacks', () => {
    expect(contactNoticeEvidenceFor('de', [NOTICE])?.noticeLocale).toBe('en')
  })

  it('pins the newest notice in force', () => {
    const newer = { ...NOTICE, noticeVersion: '4.1' }
    expect(contactNoticeEvidenceFor('en', [NOTICE, newer])?.noticeVersion).toBe('4.1')
  })
})
