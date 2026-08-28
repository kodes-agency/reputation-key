// Identity context — member authority lifecycle port.
//
// ARC-03-T9. Identity is built BEFORE Property, Portal and Inbox (they depend
// on Identity's manager facts), yet removing a member or demoting a role has to
// release the authorities those downstream contexts hold. The root used to
// express that with two `let` bindings that threw until they were reassigned
// ~900 lines later — a build-order cycle hidden inside a mutable variable.
//
// The seam is now named: Identity declares WHAT it needs, the composition root
// supplies an adapter that fans out to the owning contexts, and the deferred
// binding is a single explicit one-shot handoff rather than reassignment of a
// throwing placeholder.

export type MemberAuthorityLifecyclePort = Readonly<{
  /**
   * Release every authority a departing member holds: Property and Portal
   * responsible-manager intervals, Inbox assignments, and Identity property
   * access grants. `actorId` is null for provider lifecycle hooks that do not
   * expose an initiating actor.
   */
  releaseMemberAuthorities: (
    organizationId: string,
    userId: string,
    actorId: string | null,
  ) => Promise<void>

  /**
   * Re-check the member's current responsibilities after an authority change
   * and release ONLY the ones they are no longer eligible to hold.
   */
  reconcileResponsibleManagerEligibility: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>
