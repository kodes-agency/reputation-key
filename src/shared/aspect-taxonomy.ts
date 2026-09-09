// Public schema/version contract consumed by operational and settings tooling over time.
export const ASPECT_TAXONOMY_VERSION = 'aspect-taxonomy-v1' as const
export const ASPECT_TAXONOMY_V1_DIGEST =
  '856740c88ef24ffeb18744b48e1ec41b1cca561d22af6aa1124f8d413ca1ecb4' as const

export const ASPECT_TAXONOMY_V1 = Object.freeze([
  'service',
  'staff',
  'quality',
  'value',
  'cleanliness',
  'wait_time',
  'atmosphere',
  'location',
  'accessibility',
  'other',
  'room',
  'food_and_drink',
  'noise',
  'wifi_and_tech',
  'check_in_out',
  'parking',
  'amenities',
  'events',
] as const)

export type AspectTaxonomyV1Id = (typeof ASPECT_TAXONOMY_V1)[number]

export const ASPECT_POLARITIES_V1 = Object.freeze([
  'positive',
  'neutral',
  'negative',
] as const)
export type AspectPolarityV1 = (typeof ASPECT_POLARITIES_V1)[number]

export type ReplyTemplateAspect = (typeof ASPECT_TAXONOMY_V1)[number]

const ASPECTS = new Set<string>(ASPECT_TAXONOMY_V1)
export function isAspectTaxonomyV1Id(value: string): value is AspectTaxonomyV1Id {
  return ASPECTS.has(value)
}

export function isReplyTemplateAspect(value: string): value is ReplyTemplateAspect {
  return ASPECTS.has(value)
}
