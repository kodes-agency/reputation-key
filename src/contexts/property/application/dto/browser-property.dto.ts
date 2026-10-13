// Property context — the Property as a browser may receive it.

import type { Property } from '../../domain/types'

/**
 * What a browser is told about the Google review destination: its state and
 * when it was read. The URI stays on the server in every state. A guest is
 * given it by the Portal publication, and only while it is `verified`.
 */
export type BrowserGoogleReviewDestination = Readonly<
  Pick<NonNullable<Property['googleReviewDestination']>, 'state' | 'retrievedAt'>
>

/**
 * Browser-safe Property. Contains no provider or connection identifiers: the
 * Google account and location suffixes, the Organization connection reference
 * and the review URI are server-only (ADR 0050). The manager app reads the
 * binding and destination states, never the identifiers behind them.
 */
export type BrowserProperty = Readonly<
  Omit<
    Property,
    'gbpAccountId' | 'gbpLocationId' | 'googleConnectionId' | 'googleReviewDestination'
  > & { googleReviewDestination?: BrowserGoogleReviewDestination }
>

/** The one mapping every Property server function answers through. */
export function toBrowserProperty(property: Property): BrowserProperty {
  const {
    gbpAccountId: _account,
    gbpLocationId: _location,
    googleConnectionId: _connection,
    googleReviewDestination: destination,
    ...browserSafe
  } = property
  if (!destination) return browserSafe
  return {
    ...browserSafe,
    googleReviewDestination: {
      state: destination.state,
      retrievedAt: destination.retrievedAt,
    },
  }
}
