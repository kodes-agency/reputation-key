// BQC-4.3 — providerConfigFor: the composition root's single mapping from a
// logical provider reference (ProcessingTarget.provider, from the router's
// CELL_TARGETS) to provider endpoint construction config.
//
// Fail closed (ADR 0048/0031): an unknown, denied, or missing provider ref
// throws — there is no default endpoint to fall back to. The logical ref is
// never a URL callers could misuse; URLs exist only inside this mapping.

import { describe, it, expect } from 'vitest'
import { providerConfigFor } from '#/composition'

describe('providerConfigFor (BQC-4.3)', () => {
  it("maps the beta cell's 'gbp-default' ref to the current global GBP endpoints", () => {
    expect(providerConfigFor('gbp-default')).toEqual({
      gbpApiBaseUrl: 'https://mybusinessbusinessinformation.googleapis.com/v1',
      reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
      notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
      oauthTokenUrl: 'https://oauth2.googleapis.com/token',
      oauthUserInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
    })
  })

  it.each([undefined, '', 'gbp-europe', 'gbp-global', 'europe', 'gbp-secondary'])(
    'throws for the unapproved provider ref %s (fail closed — no fallback)',
    (ref) => {
      expect(() => providerConfigFor(ref)).toThrow(/provider/i)
    },
  )
})
