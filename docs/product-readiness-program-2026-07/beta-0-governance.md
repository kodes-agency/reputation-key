# BETA-0 Governance — Data Inventory, Beta Terms, and Stop Conditions

**Status:** Draft  
**Date:** 2026-07-14  
**Phase:** BETA-0 (Safety, Security, and Controlled Scope)  
**Owners:** See [Named owners](#5-named-owners-and-responsibilities) below.

**Google disposition:** [Written response received](google-business-profile-ai-policy-response-2026-07-14.md); the submitted per-property AI architecture is conditionally permitted, but AI remains beta-dark.

---

## 1. Data Inventory Template

Every context, queue, cache, log/trace sink, object store, email provider,
Google integration, backup target, test fixture, and future AI surface must
have a completed row in this inventory before real property data enters the
system. Copy the template below per data class.

### Template

| Field                | Description                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Context / System** | Bounded context or infrastructure component (e.g. `review`, `identity`, S3, logs).                                             |
| **Data class**       | Category of data stored or processed (e.g. review text, reviewer display name, OAuth refresh token, staff email).              |
| **Sensitivity**      | `public` · `internal` · `confidential` · `restricted` (see classification below).                                              |
| **Retention**        | How long the data persists and the mechanism that enforces it (e.g. "90 days, TTL on Redis", "indefinite until org deletion"). |
| **Deletion path**    | The code path or operator procedure that deletes this data when a tenant leaves or a request is received.                      |

### Sensitivity classification

| Level          | Definition                                                   | Examples                                                        |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `public`       | Intentionally visible to unauthenticated visitors.           | Portal name, public link tree.                                  |
| `internal`     | Visible to authenticated org members.                        | Staff assignments, goal definitions, dashboard aggregates.      |
| `confidential` | Visible only to the data subject or authorized operators.    | Member email, staff activity log, review reply draft.           |
| `restricted`   | Credentials, secrets, PII that must never appear in UI/logs. | OAuth refresh token, encryption keys, reviewer PII from Google. |

### Initial inventory (BETA-0 baseline)

| Context / System        | Data class                                         | Sensitivity           | Retention                                                     | Deletion path                                                   |
| ----------------------- | -------------------------------------------------- | --------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| `identity`              | User email, name, password hash                    | confidential          | Until account deletion                                        | Operator command → cascade delete user + session rows           |
| `identity`              | Organization name, slug                            | internal              | Until org deletion                                            | Operator command → cascade delete org + all child rows          |
| `identity`              | Session tokens                                     | restricted            | Session TTL (Better Auth)                                     | Session expiry / revoke                                         |
| `integration`           | Google OAuth refresh token (encrypted)             | restricted            | Until connection disconnect                                   | Disconnect command → delete connection row + revoke at Google   |
| `integration`           | Google Business Profile location data              | confidential          | Until connection disconnect                                   | Disconnect cascade                                              |
| `review`                | Raw Google review text, reviewer identity, rating  | confidential          | Refresh or remove under applicable 30-day cache policy        | Source lifecycle refresh/expiry/disconnect/purge                |
| `review`                | Google-observed/published reply text               | confidential          | Refresh or remove under applicable 30-day cache policy        | Source lifecycle refresh/expiry/disconnect/purge                |
| Future `ai`             | Derived sentiment, score, category, theme, summary | confidential/internal | AI disabled in beta; later approved product/privacy retention | Property consent/lifecycle participant; no raw content embedded |
| `inbox`                 | Inbox item status, notes, assignment               | internal              | Until org deletion                                            | Org deletion cascade                                            |
| `goal`                  | Goal template, instance, progress reading          | internal              | Until org deletion or goal cancel                             | Goal cancel / org deletion cascade                              |
| `notification`          | In-app notification body                           | internal              | 30-day TTL                                                    | Scheduled cleanup job                                           |
| `notification`          | Email content (Resend)                             | confidential          | 30 days (provider)                                            | Provider retention policy + suppression list                    |
| `portal`                | Portal configuration, link tree                    | public / internal     | Until org deletion                                            | Org deletion cascade                                            |
| `guest`                 | Guest session salt, scan event                     | confidential          | 90-day TTL                                                    | TTL expiry                                                      |
| `activity`              | Activity event log (audit trail)                   | confidential          | 365 days                                                      | Scheduled cleanup job                                           |
| `team` / `staff`        | Team membership, staff assignment                  | internal              | Until assignment removal / org deletion                       | Assignment removal / org deletion cascade                       |
| `badge` / `leaderboard` | Badge definition, leaderboard snapshot             | internal              | Until org deletion                                            | Org deletion cascade                                            |
| Logs / traces (pino)    | Request ID, org/user ID, error codes               | confidential          | 30 days                                                       | Log rotation                                                    |
| Object storage (S3)     | User avatar, portal media                          | confidential          | Until org deletion                                            | Org deletion cleanup job                                        |
| Redis (cache / queue)   | Session cache key, rate-limit counter, job payload | restricted / internal | TTL-based                                                     | TTL expiry                                                      |
| Backups                 | Full database snapshot                             | restricted            | ADR 0031/provider policy; must not extend raw Google cache    | Rotation plus restore-time purge ledger or approved erasure     |
| Test fixtures           | Synthetic review/property data                     | internal              | Ephemeral (lease-scoped)                                      | Test environment lease cleanup                                  |

> **Action required:** Each context owner must verify, correct, and sign off
> on their rows before BETA-0 closes. Add rows for any data class not listed.

---

## 2. Beta Terms Summary

### 2.1 Access model

| Term                   | Rule                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Invitation**         | Invite-only. No public registration. Operators create organizations and send single-use, expiring invitations.                |
| **Email verification** | A verified email is required before any organization or property access is granted.                                           |
| **Roles**              | Built-in roles only: `owner`, `admin`, `member`. Custom/dynamic role creation is server-disabled for the beta.                |
| **Capabilities**       | Every non-core capability defaults to OFF. Capability decisions are server-enforced; the UI is a read-only explanation layer. |

### 2.2 Feature scope (beta-dark)

The following are **disabled** for the entire beta period:

- AI analysis, AI reply generation, AI trend detection (`ai.*`)
- Public guest submissions and guest workers (`guest.*`)
- Public portal writes and uploads (`portal.write`, `portal.upload`)
- Non-auth email notifications (`notification.send_email` — fail-closed)
- Custom role creation and dynamic role resolver
- Leaderboard evaluation and snapshots
- Badge awards and evaluation jobs

### 2.3 Data and Google access disclosure

- No real Google connection is enabled until the property is on the operator
  allowlist AND the received Google disposition is translated into accepted
  ADR 0031/source-content controls.
- Review content from Google is treated as confidential; reviewer PII is
  never logged or indexed in full text. It is never passed to an AI processor
  during beta. A later enabled AI path must remove structured identity and
  free-text PII, use a no-training/minimum-retention approved regional provider,
  and record merchant opt-in.
- Google refresh tokens are encrypted at rest (AES-256-GCM) and never
  appear in logs, error messages, or client responses.

### 2.4 Acceptable use

- Beta participants must not enter real customer data without operator approval.
- Beta participants must not attempt to access other organizations' data.
- Beta participants must report any unexpected data exposure to the security contact immediately.

---

## 3. Beta Stop Conditions

If **any** of the following conditions is detected, the beta is immediately
paused. New effects (writes, publishes, emails, imports) are halted via the
BETA_CAPABILITIES_OFF kill switch while canonical data and evidence are
preserved for investigation.

| #        | Condition                                                                                                                                                    | Immediate action                                                                                    | Investigation owner  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------- |
| **SC-1** | **Tenant isolation breach** — one org's data visible to another org through any path (API, UI, cache, log, background job).                                  | Freeze all external capabilities. Preserve logs.                                                    | Security owner       |
| **SC-2** | **Unauthorized Google action** — a Google API call made without an explicit user-initiated action or beyond the granted scope.                               | Disconnect affected Google connections. Freeze `property.connect_gbp` and `property.publish_reply`. | Integration owner    |
| **SC-3** | **Data loss** — unexplained disappearance of review, reply, goal, or property data that cannot be attributed to normal lifecycle.                            | Freeze all mutations. Restore from last known-good backup into a staging copy.                      | Product owner        |
| **SC-4** | **Duplicate publish** — the same reply published to Google more than once.                                                                                   | Freeze `property.publish_reply`. Audit publish log for idempotency failure.                         | Integration owner    |
| **SC-5** | **Leaked secret** — any credential (OAuth token, encryption key, API key, DB password) found in logs, error output, client response, or a public repository. | Rotate the exposed credential immediately. Audit access logs. Freeze external effects.              | Security owner       |
| **SC-6** | **Restore failure** — inability to restore from backup within the defined RTO, or a backup that fails integrity verification.                                | Freeze mutations. Engage infrastructure team. Do not resume until a verified restore succeeds.      | Infrastructure owner |
| **SC-7** | **Policy violation** — any operation that violates the beta terms, the Google disposition (ADR 0031), or applicable privacy regulation.                      | Freeze the affected capability. Escalate to privacy owner for legal assessment.                     | Privacy owner        |

### Resume criteria

The beta resumes only when **all** of the following hold:

1. The root cause is identified and documented.
2. A fix is deployed and verified against the specific failure mode.
3. A regression test exists that would have caught the original failure.
4. The product, security, and privacy owners have signed off in writing.
5. Any affected data has been restored or its loss has been acknowledged and communicated to affected participants.

---

## 4. Operator Access Controls

| Control                     | Requirement                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Named access**            | Only named individuals with a documented work reason may access production data.                                               |
| **Audited elevation**       | Every privilege escalation (read-only → read-write, or temporary admin grant) is logged with reason and timestamp.             |
| **Short-lived credentials** | No long-lived production credentials. Use short-lived, scoped tokens.                                                          |
| **Review-text masking**     | Routine operator tooling (dashboards, support views) masks review text and reviewer identity by default. Unmasking is audited. |

---

## 5. Named Owners and Responsibilities

> These are placeholder roles. Replace `[NAME]` with the accountable individual
> before BETA-0 closes.

### Product owner

**Placeholder:** `[PRODUCT_OWNER_NAME]`

Responsible for:

- Signing off on the data inventory completeness.
- Approving beta participant admission and property allowlisting.
- Authorizing resume after a stop condition.
- Ensuring beta scope does not expand beyond the agreed feature set.

### Privacy owner

**Placeholder:** `[PRIVACY_OWNER_NAME]`

Responsible for:

- Reviewing and approving the data inventory for sensitivity classification.
- Approving ADR 0031 and verifying that Google's received disposition is translated into code controls.
- Assessing policy violations (SC-7) and determining legal/ regulatory exposure.
- Owning data subject request process (access, correction, deletion, export).
- Approving subprocessor list and processing regions.

### Security owner

**Placeholder:** `[SECURITY_OWNER_NAME]`

Responsible for:

- Owning the threat model and its mapping to OWASP ASVS controls.
- Investigating tenant isolation breaches (SC-1) and leaked secrets (SC-5).
- Owning secret rotation, revocation, and inventory.
- Approving security header, cookie, and transport policies.
- Owning the incident contact tree and dry-run exercises.

---

## 6. Review cadence

| Review                      | Frequency                              | Owner    |
| --------------------------- | -------------------------------------- | -------- |
| Data inventory completeness | Before BETA-0 close, then quarterly    | Product  |
| Stop condition dry run      | Before real data entry, then quarterly | Security |
| Capability allowlist audit  | Monthly during beta                    | Product  |
| Secret rotation audit       | Quarterly                              | Security |
| Privacy compliance review   | Before real data entry, then quarterly | Privacy  |

---

_This document is a living governance artifact. Changes require sign-off from
all three named owners._
