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

## Rejected Alternatives

- **Default-on email for all categories** — sends recognition/workflow email without deliberate policy.
- **Event-ID in coalescing key** — prevents resource-level dedupe; every event creates a new unread item.
