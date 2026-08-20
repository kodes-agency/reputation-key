// Human labels and filter options for the AI primary categories.
//
// One source for every surface that names a category: the inbox filter Select,
// the review-analysis badge, and the property dashboard's topic breakdown. All
// three derive from AI_PRIMARY_CATEGORIES -- the catalogue the provider output
// schema is built from -- so the ten ids exist in exactly one place.
//
// The canonical ids are lower_snake ASCII words, so sentence-casing them IS the
// label (`wait_time` -> `Wait time`). A hand-written map would be a second copy
// of the catalogue that nothing forces to stay in step.
import { AI_PRIMARY_CATEGORIES } from '#/shared/openai-route-output-schemas'

export type AiPrimaryCategory = (typeof AI_PRIMARY_CATEGORIES)[number]

export const AI_CATEGORY_LABELS: Readonly<Record<AiPrimaryCategory, string>> =
  Object.freeze(
    Object.fromEntries(
      AI_PRIMARY_CATEGORIES.map((category) => [
        category,
        category.charAt(0).toUpperCase() + category.slice(1).replaceAll('_', ' '),
      ]),
    ) as Record<AiPrimaryCategory, string>,
  )

/** Category options in canonical order — derived, never hand-listed. */
export const AI_CATEGORY_OPTIONS: ReadonlyArray<
  Readonly<{ value: AiPrimaryCategory; label: string }>
> = Object.freeze(
  AI_PRIMARY_CATEGORIES.map((value) => ({ value, label: AI_CATEGORY_LABELS[value] })),
)
