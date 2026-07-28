// Portal context — public slug lookup outcome mapping (BQC-5.6).
//
// The repository contract for the public slug lookup is "result | null |
// throw portalError('portal_inactive')". Cross-context consumers must not
// depend on portal domain errors, so the public-api surface maps that
// contract to a typed outcome union (review eligible-reads precedent). Only
// portal_inactive is mapped — every other error propagates unchanged,
// preserving the historical passthrough semantics.

import { isPortalError } from '../domain/errors'
import type { PublicPortalBySlugOutcome, PublicPortalBySlugResult } from './public-api'

/** Map the repository throw/null contract to the public-api outcome union. */
export const toPublicPortalBySlugOutcome = async (
  lookup: () => Promise<PublicPortalBySlugResult | null>,
): Promise<PublicPortalBySlugOutcome> => {
  try {
    const result = await lookup()
    if (result === null) return { status: 'not_found' }
    return { status: 'found', result }
  } catch (err) {
    if (isPortalError(err) && err.code === 'portal_inactive') {
      return { status: 'inactive' }
    }
    throw err
  }
}
