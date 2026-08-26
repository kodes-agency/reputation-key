---
status: accepted
date: 2026-08-26
---

# 0056 — Operational Action History integrity claims

## Context

ADR 0045 correctly separates domain facts, user-visible Activity, and restricted
security/audit data, but it requires tamper-evident integrity without defining or
implementing a cryptographic construction. The beta must preserve important
manager and operator actions while avoiding claims that the current database and
application roles cannot prove.

## Decision

1. **Domain facts** are source-context-owned, versioned, content-minimal records
   used by trusted consumers and recovery. Required state and its fact commit in
   one regional PostgreSQL transaction.
2. **Recent Activity** is a privacy-aware product feed for authorized managers.
   It contains user-meaningful collaboration summaries and may be redacted,
   tombstoned, or expired under its own policy.
3. **Operational Action History** is a durable, access-controlled record of
   security-sensitive, external-effect, authorization, lifecycle, and operator
   actions. It is append-oriented at the application boundary and has explicit
   retention, export, and legal-hold policy.
4. Beta documentation and UI must not describe current Activity or Operational
   Action History as immutable, tamper-proof, tamper-evident, cryptographically
   verifiable, or compliance-grade.
5. Such a claim requires a separate accepted design that specifies the threat
   model, canonical encoding, sequence/ordering authority, key custody and
   rotation, checkpoint anchoring outside the mutable database, verification,
   restore/fork behavior, administrative bypass detection, retention/legal hold,
   and independently reviewed tests.
6. Until that design exists, integrity controls are ordinary defense in depth:
   least-privilege writers/readers, state/fact atomicity, append-oriented APIs,
   protected backups, access logging, reconciliation, and operator-visible gaps.
   These controls must be described accurately rather than promoted into a
   cryptographic guarantee.
7. No history payload may copy review text, private feedback/contact, Inbox note
   text, reply bodies, tokens, credentials, presigned URLs, raw network
   identifiers, or other prohibited content.

## Supersession

This ADR supersedes ADR 0045 rule 5 and any documentation that treats
tamper-evident audit integrity as already implemented. ADR 0045's separation of
domain facts, Activity, and restricted audit/action records remains valid.

## Consequences

- Operational Action History can ship for beta with honest durability and access
  claims while cryptographic integrity remains a separately gated capability.
- Product Activity cannot be used as the security/audit authority.
- A later cryptographic design must migrate and classify legacy records; it
  cannot retroactively claim integrity for mutable historical rows.

## Rejected alternatives

- **Keep the word “immutable” as an aspiration** — users and operators read it as
  a property of the current system.
- **Hash each row in the same mutable database** — without external anchoring and
  controlled key/sequence authority, privileged mutation can rewrite both data
  and hashes.
