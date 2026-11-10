/**
 * Every bounded context must give an Organization export an explicit,
 * content-free answer. Dark/empty contexts still return a `no_data`
 * contribution; silently omitting one would make a partial export look
 * complete.
 */
export const ORGANIZATION_LIFECYCLE_CONTEXTS = [
  'activity',
  'ai',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
] as const

export type OrganizationLifecycleContext =
  (typeof ORGANIZATION_LIFECYCLE_CONTEXTS)[number]

const CONTENT_FREE_EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/

export function validateLifecycleEvidenceRef(value: string): string {
  if (value.length > 200) {
    throw new Error('supportEvidenceRef must be at most 200 characters')
  }
  if (!CONTENT_FREE_EVIDENCE_REF.test(value)) {
    throw new Error('supportEvidenceRef must be a content-free identifier')
  }
  return value
}
