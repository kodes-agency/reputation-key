// A manager's prompt deferral hides its month and earlier ones, never later
// months (ADR 0068). The use case authorizes goal.create before reading/writing;
// one disposable row per Property records month, actor and time.

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
