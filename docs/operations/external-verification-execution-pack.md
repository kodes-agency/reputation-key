# External verification execution pack

**Date:** 2026-08-28
**Scope:** the 34 packages whose external axis is not `not_required`
**Companion:** [`docs/program-completion-plan-2026-08-28.md`](../program-completion-plan-2026-08-28.md)

## What this is

Thirty-four of the forty-two packages cannot close inside this repository. They
need authorized Railway mutation, a live `cell-us` deployment, a real
non-customer Google Business Profile, real devices and assistive technology,
production database reads, an independent ticketing authority, or external
counsel.

The repository's job is to make each of those a **mechanical run whose evidence
shape was fixed before the run**. That ordering is the whole safety property: if
the schema exists first and the validator fails closed, an operator cannot
accidentally produce evidence that flatters the system, and cannot produce it at
all if the thing being proven did not happen.

Nothing here should be executed by anyone without the authority named in its
row. Nothing here may be substituted, approximated, or inferred.

## The rule this pack exists to protect

> A passed unit test is not runtime registration, production artifact
> reachability, provider outcome, or restored-data proof.

Every producer below refuses rather than improvises. A canary sampler with no
reachable endpoint exits non-zero. An importer with a missing field names the
field. An approval envelope with an unsigned payload fails. A legal revision set
refuses to exist while any document is a draft. Those refusals are the product,
as much as the artifacts are.

## Lane A — Counsel

**Blocks:** `LEG-01`, and through it `LIF-01`, `GST-01`, `ACT-01`, `OBS-01`,
`AI-01`, `REL-01`.
**Who:** external counsel who is not the engineering owner. Engineering cannot
self-approve this gate, and the registry refuses an approver whose role is not
external counsel or who appears in the self-approval prohibition.

**Prepared:**

- `docs/legal/counsel-decision-checklist.json` — nine categories, every item
  carrying its question, source document, a verbatim anchor found in that
  document, the repository fact that constrains the answer, and the documents it
  blocks.
- `docs/legal/legal-document-registry.json` — five documents, five drafts, zero
  approvals, three publication blockers.
- `pnpm check:legal-registry` — recomputes every digest and refuses drift,
  self-approval, expiry, an unregistered document, and approving a document
  while an item blocking it is open.
- `pnpm release:create-legal-revision-set` — refuses while any counsel-owned
  document is a draft. Run it today and it exits non-zero; that is the
  fail-closed path working.

**To execute:** counsel answers the checklist items, the answers are recorded
with `decidedBy`/`decidedOn`/`evidenceRef`, the documents are approved with an
approval evidence reference retained outside public source control, and the
revision set is produced. Only then does Gate F's counsel approval become
possible.

## Lane B — Railway platform

**Blocks:** `REG-01`, `REG-02`, `REG-03`, `REG-04`, `ARC-02`, `NTF-01`,
`SAFE-01`, `GOV-01`, `REL-01`.
**Who:** an operator with authorized Railway access to the beta workspace.

The ledger records the live state honestly: only production, staging and
google-closed-beta environments exist, all observed resources are in Amsterdam,
PITR is reported disabled and there are no backups. The target is one logical US
cell, `cell-us`, and nothing in this repository has changed that state.

**Prepared:** `.railway/` models the topology as TypeScript IaC;
`pnpm infra:railway:plan-cell` produces a reviewable plan;
`pnpm infra:railway:validate` checks it; `pnpm release:rehearse-recovery --plan`
writes a recovery plan and stops.

**To execute, in order:** review the exact foundation plan, resolve the legacy
Config-as-Code ownership diagnostics, create `cell-us` only, provision its
isolated resources, enable backups and PITR, then attach signed sources. Every
step produces a receipt the evidence importers consume.

## Lane C — Deployed `cell-us`

**Blocks:** `FND-03`, `FND-04`, `SAFE-02`, `EXP-02`, `IBX-01`, `AI-02`,
`AI-04`, `REL-01`, `ARC-03`'s boot confirmation.
**Requires:** a frozen candidate promoted to `cell-us` under an authorized plan.

**Prepared:**

- `pnpm release:freeze-candidate` — pins one SHA and refuses a dirty worktree,
  an unmerged SHA, generated-artifact drift, or an existing freeze.
- `pnpm release:deployed-journeys` — the isolated read-only browser project,
  zero retries, refusing any non-production origin, checking its authorization
  window before it launches a browser.
- `pnpm release:observe-canary` — GET-only sampling against the ratified
  threshold profile.
- `pnpm release:capture-readback` — the four typed promotion artifacts, written
  even when a check failed.
- The per-deployable boot report schema, so each process can be confirmed to
  hold exactly one Application Container with the expected capability set.

**One open decision blocks the canary:** ADR 0059 ratifies the nine signal
categories, sources, comparators and thresholds, but records the observation
**window duration** as open for an operating owner. Engineering did not choose
it. Until it is ratified, `release:observe-canary` exits non-zero naming that
decision.

## Lane D — Google Business Profile

**Blocks:** `GGL-01`, `RPL-01`, `SAFE-04`, `REV-01`, `AI-03`.
**Who:** an authorized operator with a real non-customer Google Business
Profile. **Google Business Profile has no sandbox**, so stub evidence and live
evidence are two different classes and must stay explicit.

**Prepared:** the live-provider matrix carries a structural `mode` discriminator,
so stub evidence cannot be presented as live evidence, and the importer
normalizes an operator's captured output into the typed shape.

**Also required:** the user's written Google confirmation must be bound into the
release evidence with its scope, conditions, expiry and a named change-monitoring
owner. Having the confirmation is not the same as having it as evidence.

## Lane E — Production database reads

**Blocks:** `PPL-01`, `EXP-01`, `REV-01`, `SAFE-03`, `CNV-01`, `IBX-01`.
**Who:** an authorized operator in an approved read-only window.

**Prepared** — every command is read-only, takes an explicit `--as-of` or
`--observed-at`, and has no apply path:

| Command                                  | Answers                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `ops:report-inbox-handling-cutover`      | exact / mappable / ambiguous / orphan legacy classification |
| `ops:report-legacy-rollups`              | legacy Metric rollup row counts and foreign keys            |
| `ops:report-legacy-import-control`       | legacy Google import control inventory                      |
| `ops:report-compatibility-read-surfaces` | the seven mirrors, with an active reader count each         |
| `ops:report-non-fk-references`           | references no foreign key would catch                       |
| `ops:report-legacy-people-team`          | people/team contraction inventory                           |
| `ops:report-legacy-recognition`          | the 13 retained Recognition tables                          |
| `ops:manage-dormant-billing-data`        | dormant Billing inventory                                   |

The contraction registry proves every `bounded_contraction` and
`compatibility_read` table has exactly one such command, so a table cannot be
classified for contraction without its tool existing.

## Lane F — Real devices and assistive technology

**Blocks:** `EXP-03`.
**Who:** operators with physical hardware. This cannot be emulated, and the
accessibility debt register must not be closed from a desktop browser.

**Required:** real iPhone and Android, VoiceOver, keyboard focus traversal, 400%
zoom and 320px reflow, and high-contrast. The repository ships the
cross-browser Playwright matrix; the device and assistive-technology half is
human.

## Lane G — Signatures

**Blocks:** Gate F, and therefore `REL-01`.
**Who:** six named role holders — counsel, founder, operations, product,
security, support/incident.

**Prepared:** `pnpm release:prepare-approval` prints the canonical payload each
role signs offline. It holds no key material at all, and a test scans its source
to prove that. The verifier fails closed on an unsigned payload or an unknown
key.

## Lane H — Post-release contraction

**Blocks:** `CNV-01` physical schema drops, the `AI-02` compatibility mirror,
the `ACT-01` compatibility path.
**Requires:** one verified release, restore proof, the retention window
observed, and counsel-approved retention classes.

This lane is **deliberately last, and waiting here is a safety property rather
than a lack of progress**. Removing compatibility schema earlier would reduce
rollback safety at exactly the moment rollback matters most. No executable
contraction migration exists in this repository, and none should be drafted
until this lane opens.

## What an operator should read first

1. This document, for which lane they are in.
2. `docs/operations/immutable-release-promotion.md` for the authoritative
   promotion procedure.
3. `docs/operations/runbooks.md` for the command list.
4. The specific runbook for their drill — organization lifecycle, backup and
   lifecycle, Inbox handling-cycle cutover, or the contraction inventories.

## What this pack refuses

- It does not tell an operator how to make a gate pass. It tells them how to run
  the drill and retain what happened.
- It contains no fallback that produces evidence when the real source is
  unreachable.
- It does not let engineering sign for counsel, or for any other role.
- It does not treat a successful deploy as Gate F. Gate F is the complete
  evidence join, and a deploy without it is just a deploy.
