// The last step of joining: make the new member's Organization active, then
// move into the app. One function, so the first attempt after registration and
// every retry after a failure run the same two steps in the same order.

export type EnterWorkspaceSteps = Readonly<{
  ensureActiveOrg: () => Promise<unknown>
  /** Clears the tenant cache and navigates; never runs if the first step fails. */
  navigateToWorkspace: () => Promise<unknown>
}>

export async function enterWorkspace(steps: EnterWorkspaceSteps): Promise<void> {
  await steps.ensureActiveOrg()
  await steps.navigateToWorkspace()
}
