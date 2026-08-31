import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export const SETUP_CHECKLIST_STEP_KEYS = [
  'google_connection',
  'imported_property',
  'initial_review_sync',
  'published_portal',
  'responsible_managers',
] as const

export type SetupChecklistStepKey = (typeof SETUP_CHECKLIST_STEP_KEYS)[number]

export type SetupChecklistFact = Readonly<{
  /** Whether the canonical source is healthy/satisfied at read time. */
  currentlySatisfied: boolean
  /** Durable first completion; it never moves backwards after an outage. */
  firstCompletedAt: Date | null
}>

export type SetupChecklistFacts = Readonly<{
  /** Content-free action anchor, scoped by the repository before it is returned. */
  anchorPropertyId: PropertyId | null
  googleConnection: SetupChecklistFact
  importedProperty: SetupChecklistFact
  initialReviewSync: SetupChecklistFact
  publishedPortal: SetupChecklistFact
  responsibleManagers: SetupChecklistFact
}>

export type SetupChecklistRepository = Readonly<{
  /**
   * Reads canonical facts and monotonically records newly satisfied milestones.
   * `null` scope means Organization-wide; an array is an exact Property grant set.
   */
  readAndRecord(
    input: Readonly<{
      organizationId: OrganizationId
      accessiblePropertyIds: readonly PropertyId[] | null
    }>,
  ): Promise<SetupChecklistFacts>
}>
