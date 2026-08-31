export type PortalDestinationKind = 'google_review' | 'secondary_link'

/**
 * The only Guest-derived values allowed to outlive source facts. This shape is
 * deliberately anonymous: it contains no response/session/source identifier,
 * contact data, or business-activity timestamp.
 */
export type PortalLifetimeValues = Readonly<{
  qualifiedScanCount: number
  privateRatingCount: number
  privateRatingSum: number
  privateRating1Count: number
  privateRating2Count: number
  privateRating3Count: number
  privateRating4Count: number
  privateRating5Count: number
  privateFeedbackCount: number
  googleReviewSelectionCount: number
  secondaryLinkSelectionCount: number
}>

export type PortalLifetimeFact = Readonly<{
  contribution: PortalLifetimeValues
  /** Retained on the governed reading only until its source-fact purge. */
  destinationKind: PortalDestinationKind | null
}>

const VALUE_KEYS = [
  'qualifiedScanCount',
  'privateRatingCount',
  'privateRatingSum',
  'privateRating1Count',
  'privateRating2Count',
  'privateRating3Count',
  'privateRating4Count',
  'privateRating5Count',
  'privateFeedbackCount',
  'googleReviewSelectionCount',
  'secondaryLinkSelectionCount',
] as const satisfies readonly (keyof PortalLifetimeValues)[]

export function emptyPortalLifetimeValues(): PortalLifetimeValues {
  return {
    qualifiedScanCount: 0,
    privateRatingCount: 0,
    privateRatingSum: 0,
    privateRating1Count: 0,
    privateRating2Count: 0,
    privateRating3Count: 0,
    privateRating4Count: 0,
    privateRating5Count: 0,
    privateFeedbackCount: 0,
    googleReviewSelectionCount: 0,
    secondaryLinkSelectionCount: 0,
  }
}

function unitContribution(key: keyof PortalLifetimeValues): PortalLifetimeValues {
  return { ...emptyPortalLifetimeValues(), [key]: 1 }
}

function invalidFact(): never {
  throw new Error('Portal lifetime metric fact is invalid')
}

export function portalLifetimeFactForMetric(
  input: Readonly<{
    metricKey: string
    value: number
    destinationKind?: PortalDestinationKind | null
  }>,
): PortalLifetimeFact | null {
  switch (input.metricKey) {
    case 'portal.qualified_scan':
      if (input.value !== 1 || input.destinationKind != null) invalidFact()
      return {
        contribution: unitContribution('qualifiedScanCount'),
        destinationKind: null,
      }
    case 'portal.rating': {
      if (
        !Number.isInteger(input.value) ||
        input.value < 1 ||
        input.value > 5 ||
        input.destinationKind != null
      ) {
        invalidFact()
      }
      const starKey = `privateRating${input.value}Count` as keyof PortalLifetimeValues
      return {
        contribution: {
          ...emptyPortalLifetimeValues(),
          privateRatingCount: 1,
          privateRatingSum: input.value,
          [starKey]: 1,
        },
        destinationKind: null,
      }
    }
    case 'portal.feedback':
      if (input.value !== 1 || input.destinationKind != null) invalidFact()
      return {
        contribution: unitContribution('privateFeedbackCount'),
        destinationKind: null,
      }
    case 'portal.review_link_click':
      if (input.value !== 1) invalidFact()
      if (input.destinationKind === 'google_review') {
        return {
          contribution: unitContribution('googleReviewSelectionCount'),
          destinationKind: input.destinationKind,
        }
      }
      if (input.destinationKind === 'secondary_link') {
        return {
          contribution: unitContribution('secondaryLinkSelectionCount'),
          destinationKind: input.destinationKind,
        }
      }
      return invalidFact()
    default:
      // In particular, property.review (Google public reputation), legacy raw
      // scans, and the rating count/average Goal fanout are not this aggregate.
      return null
  }
}

export function sumPortalLifetimeContributions(
  left: PortalLifetimeValues,
  right: PortalLifetimeValues,
  rightMultiplier = 1,
): PortalLifetimeValues {
  return Object.fromEntries(
    VALUE_KEYS.map((key) => [key, left[key] + right[key] * rightMultiplier]),
  ) as unknown as PortalLifetimeValues
}

export function isEmptyPortalLifetimeContribution(
  contribution: PortalLifetimeValues,
): boolean {
  return VALUE_KEYS.every((key) => contribution[key] === 0)
}

export function assertPortalLifetimeValues(
  values: PortalLifetimeValues,
  message = 'Portal lifetime aggregate would become invalid',
): void {
  if (
    VALUE_KEYS.some((key) => !Number.isSafeInteger(values[key]) || values[key] < 0) ||
    values.privateRating1Count +
      values.privateRating2Count +
      values.privateRating3Count +
      values.privateRating4Count +
      values.privateRating5Count !==
      values.privateRatingCount ||
    values.privateRatingSum < values.privateRatingCount ||
    values.privateRatingSum > values.privateRatingCount * 5
  ) {
    throw new Error(message)
  }
}

export function applyPortalLifetimeContribution(
  current: PortalLifetimeValues,
  contribution: PortalLifetimeValues,
): PortalLifetimeValues {
  const next = sumPortalLifetimeContributions(current, contribution)
  assertPortalLifetimeValues(next)
  return next
}
