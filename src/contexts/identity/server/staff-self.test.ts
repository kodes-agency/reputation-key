import { describe, expect, it } from 'vitest'
import { STAFF_NOTICE_VERSION } from '../domain/staff-account'
import { requireOwnParticipation } from './staff-self-context'

const participationId = '11111111-1111-4111-8111-111111111111'
const own = {
  participationId,
  propertyId: 'property',
  portalId: 'portal',
  propertyName: 'Harbor',
  propertyActive: true,
  portalState: 'live' as const,
  colleagueListEnabled: false,
  timezone: 'Europe/Sofia',
  countryCode: 'BG',
  groupId: null,
}
const person = {
  linkId: 'link',
  participantId: 'person',
  noticeVersion: STAFF_NOTICE_VERSION,
  participations: [own],
}

describe('own participation selection', () => {
  it('finds the person’s own participation by id', () => {
    expect(requireOwnParticipation(person, participationId)).toEqual(own)
  })

  it('refuses an id that is not one of the person’s own', () => {
    expect(() => requireOwnParticipation(person, 'other')).toThrow(
      'Choose one of your own staff Properties',
    )
    expect(() => requireOwnParticipation(person, 'another-person')).toThrow(
      'Choose one of your own staff Properties',
    )
  })
})
