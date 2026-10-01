---
status: accepted
date: 2026-09-30
---

# 0062 — Invitation acceptance verifies email

## Context

Invitation-bound registration is the only beta account-creation path. The
invitee proves they control the address by opening the link mailed to it, yet
sign-up still asked Better Auth to send a second, verification email
(`emailVerification.sendOnSignUp`). With email verification required, as it is
in production, the new member then could not sign in until they clicked that
second link, and the join page ended on "Account created — sign in". This is
finding J0.

Better Auth 1.7.5 (re-read for this decision) also behaves in ways the saga has
to allow for:

- `signUpEmail` hard-codes `emailVerified: false`; it cannot be told the
  address is already proven.
- With `requireEmailVerification` true or `autoSignIn` false, a sign-up for an
  address that already has an account returns a synthetic user and writes
  nothing. That user carries the id our registration preallocated, so it passes
  the saga's id fence.
- Sign-in refuses an unverified address with `EMAIL_NOT_VERIFIED` (403), but
  only after the password has been checked.
- Reset-password calls `emailAndPassword.onPasswordReset` after the password
  update and before it revokes the user's sessions.

## Decision

1. **Sign-up sends nothing and opens no session.** `emailVerification.sendOnSignUp`
   is false and `emailAndPassword.autoSignIn` is false in every environment. The
   verification sender stays configured for recovery.
2. **Acceptance verifies, in the membership transaction.** The registration saga
   and its recovery job accept with `markEmailVerified`. The command store sets
   the acceptor's `emailVerified` inside the transaction that creates the
   membership. If no user row matches the acceptor's id and invited address,
   acceptance rolls back; that catches the synthetic duplicate as well.
3. **An address with an account is refused first.** Registration's `prepare`
   refuses an invited address that already has a user, unless it is the
   attempt's own user. The refusal is `account_exists`, with the "sign in, then
   open your invitation link again" copy.
4. **Registration signs in explicitly.** After the saga, `registerMember` signs
   the member in and forwards the cookies, as `signInUser` does. `/join` then
   lands them in the app. If that sign-in fails, the account still exists and
   the page asks them to sign in.
5. **The signed-in accept path does not verify.** A signed-in user accepting an
   invitation proved nothing about the invited address in that step.
6. **A password reset verifies.** The reset token was mailed to the address, so
   `onPasswordReset` marks it verified. That write is best-effort: Better Auth
   revokes the user's sessions only after the hook returns, so a failure is
   logged (without naming the user) and never fails the reset. Sign-in reports an unverified
   address as `email_not_verified` (403), and `resendVerificationEmail` sends a
   new link.
   It is rate-limited per IP and per pseudonymised address, and it always
   answers the same.

## Consequences

- No verification email is sent on invited registration. The e2e stack runs
  with verification required (`e2e/stack.env`) to hold this.
- A crash between sign-up and acceptance leaves an unverified user and no mail.
  The recovery job either accepts (verifying the address, within about five
  minutes) or compensates by deleting the user.
- Recovery now accepts an accepted attempt whatever sessions the user holds of
  their own. The explicit sign-in creates a session id Better Auth chooses, not
  the preallocated one.
- Members who joined before this change and are still unverified can recover
  through a password reset or the resend-verification path.
