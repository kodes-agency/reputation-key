// Identity context — reading Better Auth's reason code off a refusal.
//
// Better Auth refuses with an `APIError` whose `body.code` names the reason
// (`EMAIL_NOT_VERIFIED`, `USER_ALREADY_EXISTS`, `PASSWORD_TOO_SHORT`). Both the
// registration saga and the sign-in server function branch on it, and both
// receive the rejection as `unknown`, so it is read structurally.

/** The reason code on a Better Auth refusal, read structurally from `unknown`. */
export function providerRefusalCode(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== 'APIError' || !('body' in error)) {
    return null
  }
  const body: unknown = error.body
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : null
}
