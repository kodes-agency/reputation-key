# Incident lessons

These lessons describe constraints that still affect changes. The linked maps
and runbooks hold the detailed response steps.

## Browser imports can break an otherwise rendered page

A plain helper exported beside server functions can keep Node-only imports in
the browser bundle. SSR may render while hydration fails. Use server-only files
and narrow RPC/type exports; run the browser-reachability checks. The
[root map](../CONTEXT.md) and ADR 0015 in the [index](adr/README.md) explain the
boundary and its verification.

## An accepted queue job is unfinished work

A consumer can crash after a durable state change or before its receipt. Commit
state and outbox facts together, acknowledge only completed work and make
redelivery harmless. The [context map](../src/contexts/CONTEXT.md) describes
transaction ownership. Use [runbooks](operations/runbooks.md) §§7, 14 and 17 for
stalled work; do not discard a queue to hide it.

## Uncertain provider writes require observation

Google's reply write is an upsert. A timeout does not prove it failed. Read back
before retrying, and preserve the manager's approved source binding. Runbooks §6
covers ambiguous replies. A pre-read reduces the overwrite risk but cannot
eliminate a concurrent edit on Google between read and write.

## A live database changes the recovery path

An image older than applied migrations is deliberately refused. Contain external
effects, then deploy a forward repair that preserves the journal. PITR addresses
data loss. Runbooks §§8 and 28 and the [backup record](operations/backup-and-lifecycle.md)
distinguish successful data restoration from a timed return to service and
required erasure replay.

## Documentation must separate a promise from its proof

A registered alert may be unimplemented, a worker cannot report its own absence,
and a retention declaration does not erase data. Keep gaps visible in
[obligations](obligations.md). Its [verification procedures](operations/obligation-checks.md)
require observed results for live commitments rather than claiming success from
an existing test, table or procedure.
