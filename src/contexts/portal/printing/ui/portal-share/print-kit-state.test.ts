import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  describePrintKitNotLive,
  isNothingLiveRefusal,
  printKitAvailability,
  printKitHasLiveVersion,
} from './print-kit-state'
describe('printKitAvailability', () => {
  it('is ready when the address can be fetched again', () => {
    expect(printKitAvailability({ canDownloadAgain: true })).toEqual({
      ready: true,
      reason: null,
    })
  })

  it('says why not, and how to get there, when the code did not keep its address', () => {
    const availability = printKitAvailability({ canDownloadAgain: false })
    expect(availability.ready).toBe(false)
    expect(availability.reason).toMatch(/replace the code/iu)
  })
})

describe('printKitHasLiveVersion', () => {
  it('is true only for a published portal: a draft never had a live version, and turning off or archiving ends it', () => {
    expect(printKitHasLiveVersion('published')).toBe(true)
    expect(printKitHasLiveVersion('draft')).toBe(false)
    expect(printKitHasLiveVersion('disabled')).toBe(false)
    expect(printKitHasLiveVersion('archived')).toBe(false)
  })

  it('lets the read decide when the tab was not told the state', () => {
    expect(printKitHasLiveVersion(undefined)).toBe(true)
  })
})

describe('isNothingLiveRefusal', () => {
  it('recognises the server’s refusal for a portal with nothing live', () => {
    const refusal = new ServerFunctionError(
      'PortalError',
      'Publish this Portal before printing it: a print carries the live code.',
      'publication_snapshot_unavailable',
      409,
    )
    expect(isNothingLiveRefusal(refusal)).toBe(true)
  })

  it('leaves every other failure to the generic message and its Try again', () => {
    expect(
      isNothingLiveRefusal(
        new ServerFunctionError('PortalError', 'busy', 'rate_limited', 429),
      ),
    ).toBe(false)
    expect(
      isNothingLiveRefusal(
        new ServerFunctionError(
          'PortalError',
          'portal not found',
          'portal_not_found',
          404,
        ),
      ),
    ).toBe(false)
    expect(isNothingLiveRefusal(new Error('Print kit unavailable'))).toBe(false)
    expect(isNothingLiveRefusal(null)).toBe(false)
  })
})

describe('describePrintKitNotLive', () => {
  const where = { portalId: 'portal-1', propertyId: 'property-1' }
  const review = { propertyId: 'property-1', portalId: 'portal-1' }

  it('asks a draft to be published, and why: a print carries the live code', () => {
    expect(describePrintKitNotLive('draft', where)).toEqual({
      body: 'Publish this portal to make a print kit. A print carries the code of the live page.',
      review,
    })
  })

  it('asks a portal that was turned off to be published again', () => {
    expect(describePrintKitNotLive('disabled', where)).toEqual({
      body: 'Publish this portal again to make a print kit. A print carries the code of the live page.',
      review,
    })
  })

  it('sends an archived portal to the Portals list, where it is restored, not to the review', () => {
    expect(describePrintKitNotLive('archived', where)).toEqual({
      body: 'Restore this portal and publish it to make a print kit. A print carries the code of the live page.',
      review: null,
    })
  })

  it('uses the draft’s words when the server says nothing is live though the page thought so', () => {
    expect(describePrintKitNotLive('published', where)).toEqual(
      describePrintKitNotLive('draft', where),
    )
    expect(describePrintKitNotLive(undefined, where)).toEqual(
      describePrintKitNotLive('draft', where),
    )
  })

  it('offers no link to the review when the tab was not told the property', () => {
    expect(describePrintKitNotLive('draft', { portalId: 'portal-1' }).review).toBeNull()
  })
})
