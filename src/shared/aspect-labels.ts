import {
  ASPECT_POLARITIES_V1,
  ASPECT_TAXONOMY_V1,
  type AspectPolarityV1,
  type AspectTaxonomyV1Id,
} from '#/shared/aspect-taxonomy'

export const ASPECT_LABELS: Readonly<Record<AspectTaxonomyV1Id, string>> = Object.freeze({
  service: 'Service',
  staff: 'Staff',
  quality: 'Quality',
  value: 'Value',
  cleanliness: 'Cleanliness',
  wait_time: 'Wait time',
  atmosphere: 'Atmosphere',
  location: 'Location',
  accessibility: 'Accessibility',
  other: 'Other',
  room: 'Room',
  food_and_drink: 'Food and drink',
  noise: 'Noise',
  wifi_and_tech: 'Wi-Fi and tech',
  check_in_out: 'Check-in/out',
  parking: 'Parking',
  amenities: 'Amenities',
  events: 'Events',
})

/** Aspect options in the frozen taxonomy order. */
export const ASPECT_OPTIONS: ReadonlyArray<
  Readonly<{ value: AspectTaxonomyV1Id; label: string }>
> = Object.freeze(
  ASPECT_TAXONOMY_V1.map((value) => ({ value, label: ASPECT_LABELS[value] })),
)

export const ASPECT_POLARITY_LABELS: Readonly<Record<AspectPolarityV1, string>> =
  Object.freeze({
    positive: 'Positive',
    neutral: 'Neutral',
    negative: 'Negative',
  })

export const ASPECT_POLARITY_OPTIONS = Object.freeze(
  ASPECT_POLARITIES_V1.map((value) => ({
    value,
    label:
      value === 'positive' ? 'Praise' : value === 'negative' ? 'Complaints' : 'Neutral',
  })),
)
