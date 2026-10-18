// Reporting — a manager's "Not now" on the Overview's ready prompt for the
// Monthly portal goal (ADR 0068, PLAN PG-16; migration 0062's
// `portal_goal_prompt_deferrals`, one row per Property).
//
// Disposable decision state: the month a manager put the prompt off for, who
// and when. It hides that month's prompt and every earlier one, never a later
// month's. Neither read nor write checks a permission; the use case has
// authorized `goal.create` first.

export type PortalGoalPromptDeferral = Readonly<{
  organizationId: string
  propertyId: string
  /** `YYYY-MM`: the month the prompt named. */
  month: string
  deferredBy: string
  deferredAt: Date
}>

export type PortalGoalPromptDeferralStore = Readonly<{
  /** The latest month the Property's prompt was put off for; null when it never was. */
  deferredMonth(organizationId: string, propertyId: string): Promise<string | null>
  /**
   * Records "Not now" for `month`, the Property's one row: a later month moves
   * it on, an earlier or the same month leaves it as it is, so a tab left open
   * since last month never brings back a prompt put off since.
   */
  defer(deferral: PortalGoalPromptDeferral): Promise<void>
}>
