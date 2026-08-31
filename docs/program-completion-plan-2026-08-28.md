# Program completion plan — 2026-08-28

**Branch:** `codex/comprehensive-program-continuation`
**Integration checkpoint:** `d16284d761a861d8a502fcb5b56ef2a53fa562ec`
**Scope:** finish the 42-package beta implementation program
**Machine-readable backlog:** [`docs/release-evidence/review/program-completion-backlog-2026-08-28.json`](release-evidence/review/program-completion-backlog-2026-08-28.json)

## 1. What “completing all packages” can and cannot mean

The program scores every package on three independent axes, and the ledger
validator (`scripts/review/comprehensive-program-status.ts`) enforces the model
mechanically: a package closes only when implementation is `complete`,
repository verification is `passed`, external verification is `passed` or
`not_required`, and a section-16 completion record exists whose `frozen_sha`
equals the ledger baseline and whose reviewer differs from its owner.

That validator makes the honest answer unavoidable:

| Outcome                                  | Packages | Achievable in this repository |
| ---------------------------------------- | -------: | ----------------------------- |
| Repository-side work complete            |   **42** | Yes                           |
| Formal closure (all three axes)          |    **8** | Yes                           |
| Formal closure blocked on external proof |   **34** | **No**                        |

The eight closable packages are the ones whose external axis is already
`not_required`: `FND-02`, `ARC-01`, `ARC-03`, `POR-01`, `MET-01`, `GOA-01`,
`REC-01`, `GOV-02`.

The other 34 need evidence that cannot be produced here and must not be
simulated: authorized Railway mutation, a live `cell-us` deployment, backup and
PITR enablement, a real non-customer Google Business Profile, real devices and
assistive technology, production database reads, an external ticketing
authority, and external counsel. This plan therefore has two deliverables, not
one:

1. **Finish every repository-side obligation** for all 42 packages.
2. **Ship an execution pack** — schemas, producers, fail-closed validators,
   commands and runbooks — that reduces each external item to a mechanical run
   by an authorized human, with the evidence shape fixed in advance so it
   cannot be faked afterwards.

Manufacturing external evidence is the one failure mode the whole program
exists to prevent. Nothing below does it.

## 2. Method

The six open packages were surveyed at file and line level, then subjected to an
adversarial completeness critique against the program spec. That produced 85
concrete repository tasks and 35 external items, recorded in the backlog JSON.
The critique added 16 uncovered program bullets, corrected 4 pieces of false
work, and flagged 6 rule conflicts. All are folded into the waves below.

Two critique entries are discarded: it reported `LEG-01` and `REL-01` as
entirely unmapped, but both maps exist — the critic's input payload was
truncated at four maps. Every other finding was re-checked against the tree.

## 3. Corrections the survey forced

These change the shape of the work and are recorded so a reviewer can reject any
variant that reintroduces them.

- **Migration numbering collision.** `IBX-01` and `LIF-01` both claimed
  `drizzle/0169`. One integrator now issues the reservation up front:
  0169 Inbox escalation history, 0170 export pre-egress evidence, 0171 context
  lifecycle receipts, 0172 backup-erasure ledger, 0173 property-erase authority,
  0174 privacy requests. No lane renumbers after another lane's migration lands.
- **`property.erase` must stay a blocked tenant capability.** It is disabled in
  `capability-fate.ts` and listed in `BLOCKED_CAPABILITIES`. The permanent-erase
  path is operator-only with an independent support authorization reference; a
  tenant-facing authorization path would have been an accidental capability
  activation.
- **Closure Center must not introduce an authentication factor.** Program bullet
  8 forbids a fresh-password or MFA requirement. The task now asserts
  `BLOCKED_CAPABILITIES` is byte-equal after the change.
- **Dark contexts gain export/lifecycle contributors without gaining a seam.**
  Every `build.ts` edit on `team`, `badge`, `leaderboard` asserts the new key is
  unreachable from `container.publicApi` and that `capability-fate.ts` is
  byte-identical.
- **`inbox_handling_cycle_transitions` already has a production reader**
  (`feedback-handling.store.ts`). The history read model extends that path
  instead of standing up a second reader with different ordering.
- **The ARC-03 completion record is repository work**, not an external item.
  Only the signature and frozen SHA are external.
- **Retention apply mode stays locked.** The registry ships in report-only mode
  with `approvalState: pending_counsel`, and no retention rule may target a
  compatibility mirror table at all.

## 4. Execution waves

Waves 1–10 are repository work. Waves 11–13 are external and are prepared, not
performed.

| Wave | Name                                                        | Concurrency | Serialized by                                             |
| ---: | ----------------------------------------------------------- | ----------- | --------------------------------------------------------- |
|    1 | Unblockers and read-only inventory                          | parallel    | none; `LIF-01-T1` merges first                            |
|    2 | Boundary tightening, shared classification, cutover reports | parallel    | one owner for `eslint.config.js` + the control script     |
|    3 | Migration integrator window #1 (0169–0171)                  | serial      | single integrator; shared journal and schema index        |
|    4 | ARC-03 composition-root window                              | serial      | exclusive owner of `src/composition.ts`                   |
|    5 | LIF-01 export contributors, Inbox history read              | parallel    | one owner per context `build.ts`                          |
|    6 | Composition window #2: contributor composition              | serial      | exclusive owner of the split composition                  |
|    7 | Lifecycle phases across 17 contexts, Inbox history UI       | serial      | closing → readiness → purge is a hard chain               |
|    8 | Migration integrator window #2 (0172–0174)                  | serial      | single integrator; ledger precedes its writers            |
|    9 | Lifecycle surfaces, retention (report-only), replay, E2E    | parallel    | Closure Center precedes reactivation                      |
|   10 | Proved-dead deletion and package closure records            | parallel    | every deletion follows its replacement's cutover          |
|   11 | External approvals and approval-authority wiring            | serial      | **external** — counsel and role signatures                |
|   12 | REL-01 candidate, gates, promotion, canary                  | serial      | **external** — no deployment is possible here             |
|   13 | Post-release schema contraction                             | serial      | **blocked** until one verified release plus restore proof |

### Why wave 4 is exclusive

`src/composition.ts` is 1,863 lines and is edited by thirteen ARC-03 tasks plus
three from other packages. `ARC-03-T10` pins it under 1,000 lines and
`ARC-03-T15` splits it into per-deployable builders. Any LIF-01 or IBX-01
composition edit written before that window closes would be rebased onto a file
that no longer exists in that form. `ARC-03-T7` and `T8` are mechanical facade
changes and land first so the 33 later contributor wirings are written once.

### Why `LIF-01-T1` is first

`eslint-rules/cross-context-public-api.mjs` lets a foreign context import only
`application/public-api` or, from `infrastructure/adapters/**`,
`application/ports/**`. Identity's public API exports no contributor type
today, so all 32 cross-context lifecycle and export adapters are unbuildable
until that one small export lands.

## 5. Per-package repository scope

Counts are tasks in the backlog JSON.

### `ARC-03` — 17 tasks (+4 added by the critique)

Bring `scripts/**` under `eslint-plugin-boundaries` with the missing negative
control; give sidecars a named shared kernel instead of blanket `shared-*`
access; split the `shared-other` catch-all so the documented dependency rules
stop being documentation-only; move release authorities out of
`src/shared/testing`; make `CONTEXT.md` public-API sections mechanically
conform; give the container a shutdown seam and stop the leaked policy poller;
make the outbox consumer registry, ExecutionPolicy and CapabilityPolicyStore
container-scoped; remove the late-bound build-order cycles; extract the Google
wiring; retire all 45 `.internal.*` reach-throughs (not only the 20 repository
ones); put ambient request context and better-auth behind ports; ban ambient
environment re-reads with an executable allowlist; build exactly one Application
Container per deployable with independent process fixtures; split
`src/bootstrap.ts` by catalogue owner; relocate business rules out of `shared/`;
realign `docs/standards.md` §3; publish the section-16 record.

### `IBX-01` — 10 tasks (+3)

Legacy classification contract and read-only parity report with a signed
cutover runbook; append-only escalation history; Inbox-owned handling history
read model extending the existing transitions reader; bounded actor
display-name resolution; the manager history panel; a fresh-database replay
matrix; repaired and extended E2E specs; cut the `inbox_items.status` writers
and mark the mirror read-only; reminder time-travel tests across halfway,
target and post-target boundaries; a rule that retention, redaction and
source-unavailable can never produce a manager handling outcome.

### `LIF-01` — 22 tasks (+3)

The largest remaining body of work. Export contributors for all 16 non-Identity
contexts against the frozen contract; durable pre-egress evidence and
post-upload/pre-completion crash recovery; closing, purge-readiness and purge
contributions for all 17 contexts; the backup-erasure ledger and restore
resurrection fence; the counsel-ready retention registry in report-only mode;
the Closure Center; explicit reactivation; operator-only Property Erase;
privacy access/correction/withdrawal/erasure; user leave/removal with
responsibility transfer; the Purge Pending final notice; restore revalidating
Responsible Manager eligibility; and the bullet-12 reconciliation of legacy
billing, custom-role, multi-org, Team and Guest data.

### `CNV-01` — 15 tasks (+3)

Model the analyser blind spots in configuration rather than deleting real code;
delete only symbols proved dead by trace plus zero-reference grep; demote
over-public exports in three reviewed slices; resolve duplicate exports by
rename; author a reviewed public-API allowlist; build the contraction-inventory
registry and prove every `bounded_contraction` and `compatibility_read` table
has exactly one inventory command; add the non-FK textual reference scanner;
add the reachability-proof harness; publish the deletion report and completion
record. **No physical drops.**

### `LEG-01` — 10 tasks

Engineering cannot approve legal text, so the repository work is to make
counsel's job mechanical and make the code fail closed until approval exists: a
machine-readable document registry with per-document SHA-256, status and
approval evidence; a validator that fails on post-approval drift; the structured
open-decision checklist across the nine unresolved categories; typed
candidate-bound legal revision-set evidence closing the current Gate F
fail-open; a producer that refuses to emit while any document is a draft; and
registry-bound in-product notices.

### `REL-01` — 11 tasks

Turn typed contracts into safe producers: the canary threshold profile and
sampler; the deployed critical-journey spec with an origin guard that refuses
any non-production target; the report-first rollback/restore orchestrator with a
mandatory human authorization pause keyed to the plan digest; structured
promotion read-back evidence; normalized importers for every Gate F key that
has none; the authenticated approval envelope that never touches a private key;
the legal checklist binding; and the candidate freeze command.

## 6. External execution pack (waves 11–13)

Thirty-five items cannot be done here. For each, the repository ships the
schema, the producer or importer, the fail-closed validator, and the runbook, so
the external run is one documented command whose output shape was fixed before
the run. Categories:

| Category                            | Blocked on                                         |
| ----------------------------------- | -------------------------------------------------- |
| Counsel approval                    | external counsel; engineering cannot self-approve  |
| Railway platform mutation           | authorized account; backups/PITR, buckets, sidecar |
| Live `cell-us` deployment           | a frozen candidate and an authorized promotion     |
| Google Business Profile live matrix | a real non-customer profile; no sandbox exists     |
| Production database reads           | operator identity and an approved read-only window |
| Real devices and assistive tech     | physical hardware                                  |
| Role signatures                     | six named human signatories                        |

Two structural guarantees make the pack safe: the live-provider matrix carries a
`mode` field so stub evidence can never be presented as live evidence, and the
approval verifier fails closed on an unsigned or unknown-key payload.

## 7. Verification contract

Every wave ends green on the same matrix, run under Node 22.23.2:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:unit
```

Integration runs against a database created from scratch and migrated through
the whole journal, never a developer database — now structurally enforced by
`src/shared/testing/configured-database-fence.ts`:

```bash
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/repkey_verify_<stamp> pnpm test:integration
```

Baseline re-verified at the integration checkpoint: typecheck 3 projects /
3,729 modules; lint including architecture, filename, component, Zod and
product-state controls; formatting clean; unit 1,151 files and 10,922 passed
with 6 skipped; integration 190 files and 1,034 tests on a fresh database with
235 tables at journal 169.

## 8. Repository management

The 2,447-path integration tree is frozen as 34 path-scoped commits so review
and blame stay attributable. Only the series tip is a verified state;
intermediate commits are integration checkpoints, not independently green.

Implementation lands as reviewable commits on this branch, one concern per
commit, each ending on a green matrix. The branch opens as a pull request
against `main` carrying this plan, the backlog, and the per-wave evidence.

## 9. What this plan refuses to do

- Mark a package complete on one axis and present it as closed.
- Produce, simulate, or infer external evidence.
- Drop physical schema or remove a compatibility mirror before one verified
  release and restore proof.
- Activate any dark capability — Portal upload, Contact Request, Recognition,
  Team, Bulk Close, Staff User login, Billing, MFA — as a side effect.
- Introduce a second data cell. Beta is exactly one logical US cell, `cell-us`.
- Let engineering self-approve a legal gate.
