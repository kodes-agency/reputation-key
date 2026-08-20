# ADR 0046 — Notification Policy: Categories, Channels, and Preferences

**Status:** Accepted
**Date:** 2026-07-15

## Context

The notification context has schema/docs mismatches: docs describe one unread resource item while schema uniqueness includes event ID, making dedupe/coalescing inconsistent. Missing preferences enable both in-app and email by default. Digests follow property timezone, causing multi-property users to receive duplicate or inconvenient delivery. Email provider idempotency is shorter than the product retry horizon.

## Decision

Notifications have explicit **category × channel × property** preferences with versioned defaults, user timezone, quiet hours, and coalescing semantics.

### Categories

`mandatory` (account/security/legal), `urgent_operational`, `workflow_collaboration`, `digest_summary`, `recognition`.

### Default policy

| Category               | In-app                                       | Email                                                      |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Mandatory              | On, non-disableable when genuinely mandatory | On as required                                             |
| Urgent operational     | On for responsible users                     | On for explicitly responsible; bounded quiet-hour override |
| Workflow/collaboration | On                                           | Off unless user opts in                                    |
| Digest                 | Off                                          | Off; user opts in                                          |
| Recognition            | On privately                                 | Off; user opts in                                          |

### Rules

1. Missing preference rows resolve through code/versioned default policy, not "both on."
2. Coalescing: at most one unread item per `(user, type, resource)` may bump count/latest while preserving delivery/event evidence. Do not rely on event ID in the uniqueness key.
3. Recipient timezone uses user IANA timezone with organization fallback; DST tested.
4. Multi-property users receive one digest in their chosen timezone, not one per property timezone.
5. Application idempotency key persists beyond the provider's 24-hour dedupe window.
6. Delivery state: `pending → accepted → delivered|delayed|bounced|complained|failed|suppressed|cancelled`.
7. No marketing content in operational mail. Every non-mandatory email links to preferences.
8. Content uses property/resource/status metadata; omits review text, guest text, media, sensitive scores, and other employees' data.

## Consequences

- Schema uniqueness changes from event-ID-based to resource-coalescing.
- Missing preferences no longer default to "both on."
- Application-level idempotency key prevents duplicate delivery after provider dedupe expiry.
- Recognition email requires explicit user opt-in.

## Implementation notes (2026-08-21)

Recorded when the policy was actually built out. Both items are deliberate
deviations from the text above; the intent of every rule is preserved.

### `digest_summary` is retired as a category

The Decision lists five categories including `digest_summary`. The
implementation has four: `mandatory`, `urgent_operational`,
`workflow_collaboration`, `recognition`. A daily digest is expressed **only** as
`cadence = 'daily'`, which is the axis the digest worker already dispatched on.

Why: `digest_summary` duplicated the cadence axis, and the duplication was
load-bearing in the wrong direction. Its default policy was
`{in_app: false, email: false}` and `goal.completed` was its only member, so in
any tenant without an explicit preference row the goal-completed notification
was dropped at insert and never persisted at all — the category silently
deleted its own contents. `goal.completed` is now `recognition`, which is what
it always was.

`mandatory` is retained even though no type maps to it yet (rule 1 reserves it
for account/security/legal mail). It stays visible and disabled on the settings
page, which is honest: it tells the user the class exists and cannot be muted.
Filters render from `GOVERNING_NOTIFICATION_CATEGORIES`, derived from the
type→category map, so a category that governs nothing can never appear as a
filter that returns nothing.

### Rule 7 keys on mail class, not on category

The unsubscribe guard decides "may this recipient unsubscribe from this
message". That is a property of the message, not of a notification taxonomy. It
therefore takes an explicit `MailClass = 'mandatory' | 'optional'`.

Keying it on `NotificationCategory` forced the aggregate digest — which batches
notifications of several categories into one email — to invent a category for
its own envelope, which is what `digest_summary` was doing in
`digest-assembly.ts`. With `MailClass`, a digest passes `'optional'` because an
aggregate digest is never legally-required mail, and nothing has to be derived.

### Rule 8 is enforced by a parser, not by convention

Copy is rendered at read time from `type` + a `payload` column
(`domain/notification-templates.ts`), rather than frozen into a string at
enqueue time. `parseNotificationPayload` is the only way a payload enters the
domain and it drops every key outside the allowlist, so rule 8 is mechanical
rather than a reviewer's responsibility. Consequences: fixing a sentence fixes
every channel and every historical row at once, and `notifications.payload` is
registered in the protected-field registry.

## Rejected Alternatives

- **Default-on email for all categories** — sends recognition/workflow email without deliberate policy.
- **Event-ID in coalescing key** — prevents resource-level dedupe; every event creates a new unread item.
