import { describe, expect, it } from 'vitest'
import { capabilityForPermission } from './capability-for-permission'

describe('capabilityForPermission', () => {
  it('keeps existing-feedback handling independent of new collection', () => {
    expect(capabilityForPermission('feedback.handle')).toBe('inbox.use')
    expect(capabilityForPermission('feedback.read')).toBe('portal.guest_response')
  })
})
