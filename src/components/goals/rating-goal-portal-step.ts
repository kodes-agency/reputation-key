// The one next step the Google rating goal's done screen offers on the portal
// side (PLAN PG-11, D-1 and D-2). Once a Portal is live it is the monthly
// portal goal's card ("See your portal goal"), which every Property has, so the
// step is never a dead end; until then it is a first Portal ("Create a portal").
// A draft, disabled or archived Portal is not live. The pages work it out from
// the Portals they read, so the wizard reads none.

/** "See your portal goal" (`see`) or "Create a portal" (`create`). */
export type PortalNextStep = 'see' | 'create'

export function portalNextStepOf(
  portals: ReadonlyArray<Readonly<{ publicationState: string }>>,
): PortalNextStep {
  return portals.some((portal) => portal.publicationState === 'published')
    ? 'see'
    : 'create'
}
