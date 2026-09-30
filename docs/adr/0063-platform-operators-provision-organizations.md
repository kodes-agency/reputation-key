---
status: accepted
date: 2026-10-01
---

# 0063 — Platform operators provision Organizations

## Context

Accounts are invitation-only (ADR 0062), and `organization.create` is
`beta_disabled`: tenant self-service stays off. `ops:bootstrap-owner` creates
the first Organization and its owner, but it refuses to run once any
Organization exists. After that, a new customer had no path in short of
hand-written SQL. The owner needs to create each later Organization and hand it
to its first AccountAdmin, without joining it and without break-glass access to
Organizations that already have an admin.

`OPS_OPERATOR_IDENTITIES` already names the people allowed to run operator
commands, and the ExecutionPolicy has an operator branch (`system:ops`) that
denies everyone it does not list. The beta has no MFA.

## Decision

1. **Who is an operator.** A platform operator is a signed-in user whose
   verified email is listed in `OPS_OPERATOR_IDENTITIES` on the web service.
   The console at `/operator` evaluates the existing ExecutionPolicy operator
   branch (`system:ops`) with that email, trimmed and lowercased. The list itself
   is not case-folded, so its entries must be written in lowercase. An absent or
   empty list means no one. An unverified email never matches. Anyone else gets
   Not Found at `/operator`, and every console server function re-checks the
   operator.
2. **Provisioning is one transaction.** The operator creates an Organization
   without becoming its member and invites its first AccountAdmin in the same
   transaction: the Organization row, the lifecycle authority row its insert
   trigger creates, the invitation row and its `identity.member.invited` fact.
   The invitation is the ordinary invitation command, with the same guards, and
   the operator is its inviter. If the invitation is refused (the address
   belongs to, or is invited by, another Organization) nothing is created. A
   slug is taken once, under a per-slug lock. Invitation-bound registration
   remains the only way an account is created.
3. **Ownerless only.** The console acts on an Organization only while it has
   no AccountAdmin. It can invite another admin, and resend or cancel an open
   AccountAdmin invitation. Inviting and resending need an active
   Organization; cancelling does not. After an AccountAdmin accepts, the
   Organization's own admins invite, resend and cancel, and the console stops
   showing that Organization's invitee addresses.
4. **Recent sign-in and a budget.** Console changes need a session signed in
   within the last 30 minutes (`operator_reauth_required` otherwise). This is
   the beta's only step-up; there is still no MFA. Reads accept any session.
   Each operator may make 30 changes an hour, keyed by an HMAC of their user id.
5. **No tenant capability.** `organization.create` stays `beta_disabled`: it
   names tenant self-service, which remains off. Operator provisioning is not a
   tenant capability, and it adds no SystemAction or capability.
6. **No new fact.** Provisioning records no fact of its own, as
   `ops:bootstrap-owner` records none. The Organization row, its lifecycle
   authority row and the first invitation's `identity.member.invited` fact are
   the record; the operator is on record as that invitation's `inviterId`. Each
   change and each refusal also writes a content-free log line
   (`platform.organization_provisioned`, `platform.operator_denied`, …) that
   the request's trace correlates; like every log line, it carries no tenant
   identifier or address.
7. **Its own composition seam.** The console is the container key
   `identityPlatform`, built by `identity/build-platform.ts`. It is not on
   `identityPublicApi`: no other context receives it.

## Consequences

- Ownerless Organizations can exist: an invitee who never accepts, or an
  invitation the operator cancels, leaves one. The console lists them and
  flags them; inviting again fixes them. Closing an empty Organization stays an
  ops task.
- A new Organization is dark for controlled-beta capabilities until
  `BETA_ALLOWLIST_ORGS` covers it on web and worker. The console reports which
  Organizations are dark.
- The operator's user id appears as `inviterId` in that Organization's export.
  The operator is no member, so any notice addressed to the inviter as a member
  is refused.
- A stolen operator session within 30 minutes of sign-in can create empty
  Organizations or seed ownerless ones, up to the hourly budget. It cannot touch
  an Organization that has an AccountAdmin.
- An acceptance that commits while the operator invites a second admin can
  leave two AccountAdmins. That is benign and not prevented.
- The console reads every Organization across tenants. It exposes only counts
  and, for ownerless Organizations, the pending AccountAdmin invitees' emails.
