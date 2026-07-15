# ADR 0045 — Activity, Audit, and Domain Events Are Three Separate Concepts

**Status:** Accepted
**Date:** 2026-07-15

## Context

The activity context is documented as an immutable audit log, but a separate `audit_logs` table also exists. Neither has a clear audience, coverage, integrity, or retention contract. Activity snapshots actor identity and payload fields, risking personal data outliving its purpose or leaking through a broad feed.

## Decision

Three distinct models with separate ownership, audience, integrity, and retention:

| Model                     | Owner                 | Audience                        | Mutability                                                               |
| ------------------------- | --------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| **Domain event**          | Source context        | Trusted consumers/operators     | Immutable fact with schema version and consumer retention                |
| **Activity item**         | Activity context      | Authorized product users        | Presentation may be redacted/tombstoned; privacy-aware shorter retention |
| **Security audit record** | Security/audit module | Restricted operators/compliance | Append-oriented, tamper-evident, separate retention/legal hold           |

### Rules

1. Activity items cover user-meaningful collaboration only: membership changes, goal lifecycle, badge award, portal publication, reply status, integration health.
2. Security audit covers authentication/authorization decisions, grant changes, sensitive data access/export, capability activation, external publish, privacy requests, and destructive lifecycle actions.
3. Neither activity nor audit copies review text, guest text/media, email body, tokens, cookies, presigned URLs, raw network identifiers, or secrets into payloads.
4. Activity stores resource IDs and minimal reason/status; authorized detail is fetched at view time.
5. Audit integrity includes append-only privileges, restricted service roles, hash/sequence/tamper detection, and access audit.

## Consequences

- Activity context stops claiming to be the complete immutable audit log.
- `audit_logs` and activity data are separated by clear ownership and retention rules.
- Redaction/tombstone/pseudonymization jobs apply to activity; audit records have separate legal-hold controls.
- Legacy data with unknown semantics is retained under a documented legacy class until expiry.

## Rejected Alternatives

- **Single unified log** — mixes audience, retention, and legal-hold requirements; a broad feed can leak restricted data.
- **Activity as audit** — lacks tamper-evident integrity and compliance-grade retention controls.
