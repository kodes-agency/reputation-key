export const GOOGLE_CONTENT_CAPABILITIES = [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
  'property.connect_gbp',
  'property.publish_reply',
] as const

export type GoogleContentCapability = (typeof GOOGLE_CONTENT_CAPABILITIES)[number]

export function isGoogleContentCapability(
  value: string,
): value is GoogleContentCapability {
  return GOOGLE_CONTENT_CAPABILITIES.some((capability) => capability === value)
}
