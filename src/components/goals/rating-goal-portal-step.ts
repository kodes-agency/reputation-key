// Only a live Portal unlocks the monthly-goal step; draft, disabled and archived
// Portals do not. Otherwise offer the first Portal so the next step is never a dead
// end.

/** "See your portal goal" (`see`) or "Create a portal" (`create`). */
export type PortalNextStep = 'see' | 'create'

export function portalNextStepOf(
  portals: ReadonlyArray<Readonly<{ publicationState: string }>>,
): PortalNextStep {
  return portals.some((portal) => portal.publicationState === 'published')
    ? 'see'
    : 'create'
}
