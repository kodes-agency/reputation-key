// Identity context — authenticated session port.
//
// ARC-03-T13. The composition root used to call the better-auth process
// singleton (`getAuth()`) directly for four session-scoped operations. That put
// an authentication provider inside the root's vocabulary and made the four
// call sites untestable without the provider.
//
// Identity owns this contract; the composition boundary supplies the
// better-auth adapter (or a fake, in a process fixture).

export type AuthSessionPort = Readonly<{
  /**
   * Set the caller's active organization. Non-fatal by contract: during
   * registration the session cookie does not exist yet, and the user picks up
   * their active organization on first login.
   */
  setActiveOrganization: (organizationId: string) => Promise<void>

  /** Update organization fields for the caller's active organization. */
  updateOrganization: (data: Record<string, unknown>) => Promise<void>

  /** The caller's active organization name, or null when unresolvable. */
  currentOrganizationName: () => Promise<string | null>

  /**
   * Re-verify the caller's password for a step-up decision. Returns false for
   * every failure mode — a step-up that cannot be proven is not granted.
   */
  verifyPassword: (
    input: Readonly<{ headers: Headers; password: string }>,
  ) => Promise<boolean>
}>
