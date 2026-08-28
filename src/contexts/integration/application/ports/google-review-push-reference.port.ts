export type GoogleReviewPushScope = Readonly<{
  organizationId: string
  propertyId: string
  connectionId: string
  sourceEpoch: number
}>

export type GoogleReviewPushReferenceFailureCode =
  | 'not_found'
  | 'expired'
  | 'binding_mismatch'
  | 'exhausted'
  | 'capacity_exceeded'
  | 'conflict'
  | 'unavailable'

export type GoogleReviewPushReferenceStore = Readonly<{
  publish(
    input: Readonly<{
      scope: GoogleReviewPushScope
      locationName: string
      reviewName: string
    }>,
  ): Promise<
    | Readonly<{ ok: true; referenceRef: string }>
    | Readonly<{
        ok: false
        code: Extract<
          GoogleReviewPushReferenceFailureCode,
          'capacity_exceeded' | 'unavailable'
        >
      }>
  >
  resolve(
    input: Readonly<{
      scope: GoogleReviewPushScope
      referenceRef: string
    }>,
  ): Promise<
    | Readonly<{
        ok: true
        target: Readonly<{ locationName: string; reviewName: string }>
      }>
    | Readonly<{ ok: false; code: GoogleReviewPushReferenceFailureCode }>
  >
}>

export const createUnavailableGoogleReviewPushReferenceStore =
  (): GoogleReviewPushReferenceStore =>
    Object.freeze({
      publish: async () => ({ ok: false, code: 'unavailable' }) as const,
      resolve: async () => ({ ok: false, code: 'unavailable' }) as const,
    })
