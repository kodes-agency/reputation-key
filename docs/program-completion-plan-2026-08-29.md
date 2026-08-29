# Program completion plan v2 — 2026-08-29

**Branch:** `codex/comprehensive-program-continuation`
**Supersedes:** [`program-completion-plan-2026-08-28.md`](program-completion-plan-2026-08-28.md)
**Progress report:** [`comprehensive-progress-report-2026-08-29.md`](release-evidence/review/comprehensive-progress-report-2026-08-29.md)
**Scope:** finish the 42-package beta implementation program, through deployment
and external verification, to formal closure.

## 1. What changed since v1

Two things, and both change the shape of the endgame rather than the work:

1. **The repository side is nearly done.** v1 planned ten repository waves; they
   are executed. The ledger reads implementation 36/42 complete with 6 in
   progress, and what remains in the repository is four red CI gates, five open
   review findings, and five `ARC-03` tasks blocked on a local hook — not
   feature work.
2. **The operating owner granted Railway execution authority.** v1 classified
   Lanes B and C of the external pack as "cannot be produced here." They now
   can be: the agent executes them against the owner's Railway account, with
   the owner approving at the irreversible points. Roughly fifteen of the 34
   externally-blocked packages move from "waiting on an operator" onto the
   execution critical path.

Verified on 2026-08-29: the Railway account is reachable, the existing
`reputation-key` project (13 services) is visible, its resources are in
Amsterdam, no `cell-us` exists, and backups/PITR are not enabled — exactly the
honest state the ledger records. The ADR decision stands: `cell-us` is a
dedicated Railway project, and beta is exactly one logical US cell.

## 2. Ratified owner decisions

Four decisions v1 left open were put to the operating owner on 2026-08-29 and
decided. A reviewer should reject any work that quietly reopens them.

| #   | Decision                                              | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The `local-sandbox` guard vs. the local compose stack | **Key the guard on a deployed-cell signal.** The hard denial of the `local-sandbox` provider profile keys on `RELEASE_MANIFEST_SHA256` — documented as reaching every digest-promoted Railway service and nothing else — instead of `NODE_ENV`. The guard stays live in every deployed cell; the local stack keeps rehearsing the exact production images. The documented pre-promotion window, where the variable is optional, is accepted as the guard's dark window. |
| D2  | ADR 0059 canary observation window                    | **24 hours.** Covers one full daily traffic cycle including scheduled jobs and reminder sends. The ADR is to be amended from "open decision" to ratified, naming the owner and this date.                                                                                                                                                                                                                                                                               |
| D3  | The five `ARC-03` tasks blocked on `eslint.config.js` | **The owner exempts the file** in the local `config-protection` hook so the boundary tasks can land with their already-verified negative controls. Until the exemption exists, this remains the one repository task the agent cannot perform.                                                                                                                                                                                                                           |
| D4  | Railway mutation protocol                             | **Plan, then batch-approve.** The agent produces the exact `infra:railway:plan-cell` output; the owner approves it once; the agent executes the whole foundation sequence. A second explicit pause happens before promotion to `cell-us`, and nowhere else.                                                                                                                                                                                                             |

## 3. The critical path

Repository verification can only pass against one frozen immutable SHA;
`release:freeze-candidate` refuses an unmerged SHA; merging requires green CI.
So every axis funnels through one chain:

> CI green → merge PR #359 → freeze one candidate → rerun the matrix against
> that SHA → repository verification passes → deploy to `cell-us` → external
> evidence → Gate F join → closure records.

The wall-clock long pole is none of that: it is **counsel** (Lane A), followed
by the owner's device pass (Lane F) and the six role signatures (Lane G). Those
start immediately and run in parallel with everything below.

## 4. Phases

Owner-side items are marked **(owner)**; everything else is agent work.

### Phase 1 — CI to green (~2–4 working days)

1. `check:changed-code` — runtime contract evidence for the 11 named files:
   `apply-ai-authorization-lifecycle.ts`, `password-reset.dto.ts`,
   `partial-offboarding.lookup.ts`, `inbox-feedback-handling.ts`,
   `inbox-response-targets.ts`, `durable-import-reference-persistence.ts`,
   `legacy-gbp-compatibility-inventory.repository.ts`,
   `escalation-resolution-lookup.adapter.ts`,
   `portal-responsibility-runtime.ts`, `manage-portal-experience.ts`,
   `property-erase-contributor.port.ts`.
2. CodeQL — re-run the analysis first; the open set has already shrunk against
   the last gating run (`js/file-system-race` 11 → 5) and two alerts point at
   lines that no longer hold the flagged code. Then: the OAuth record-key
   derivation through the handle keyring as its own commit, handling the
   pre-deploy record window; the remaining file-system-race sites with
   full-chain containment, avoiding both flaws the adversarial review rejected
   (an `O_NOFOLLOW` claim that guards only the final path component, and a
   silent wrong digest for a non-regular file); recorded dismissals for the
   test-only `js/insecure-randomness` findings in e2e specs.
3. `audit` — 344 introduced findings. Model the deliberately-uncomposed
   lifecycle surfaces as analyser configuration (the `CNV-01`-sanctioned
   route), delete what is genuinely dead, and work the ~236 complexity findings
   down within the gate's own rules.
4. `e2e` — implement D1.
5. The five `ARC-03` boundary tasks, once D3's exemption exists **(owner)**.

### Phase 2 — Pre-freeze hardening (~1–2 days, overlaps Phase 1)

The five open independent-review findings, HIGHs first: an out-of-cell copy or
pre-restore export for the backup-erasure ledger; a reconciliation path for an
export stranded in `delete_pending`; the `runPhase` connection-pool budget; the
Gate F approved-bytes/on-disk-bytes binding; the Property Erase receipt claim.

### Phase 3 — Merge, freeze, verify (half a day)

Merge PR #359 **(owner approves)** → `release:freeze-candidate` → rerun the
full verification matrix against the frozen SHA → repository verification moves
to `passed` → section-16 records for the eight `not_required` packages
(`FND-02`, `ARC-01`, `ARC-03`, `POR-01`, `MET-01`, `GOA-01`, `REC-01`,
`GOV-02`), each reviewed by someone who is not its owner **(owner)** — the
first eight formal closures.

### Phase 4 — Railway foundation, Lane B (~1 day)

Per D4: `infra:railway:plan-cell` → plan review and batch approval **(owner)**
→ resolve the legacy Config-as-Code ownership diagnostics → create the
dedicated `cell-us` project in a US region → provision its isolated resources →
enable backups and PITR → run the recovery rehearsal → attach signed sources.
Every step retains its receipt for the evidence importers. This lane spends
money on the owner's account; the plan review is where that is priced.

### Phase 5 — Deploy and verify, Lane C (~1 day + the 24-hour window)

Promotion pause **(owner approves)** → promote the frozen candidate to
`cell-us` per the promotion runbook → per-deployable boot reports →
`release:deployed-journeys` → `release:observe-canary` under the ratified
24-hour window → `release:capture-readback`. This is the one verified release
that several downstream constraints wait on.

### Phase 6 — Remaining external lanes (parallel)

- **Lane A — counsel (owner engages; agent packages).** Send the five drafts
  and `counsel-decision-checklist.json` on day one. The agent imports answers,
  records approvals, and produces the legal revision set the moment they exist.
- **Lane D — Google (owner provides; agent drives).** A real non-customer
  Business Profile plus the owner's written Google confirmation, bound into
  evidence with scope, conditions, expiry and a named change-monitoring owner.
- **Lane E — production reads (owner authorizes; agent runs).** One approved
  read-only window; all eight `ops:report-*` commands.
- **Lane F — devices (owner performs; agent scripts).** Real iPhone and
  Android, VoiceOver, keyboard traversal, 400% zoom, 320px reflow,
  high-contrast — ~2–3 hours against a prepared checklist.
- **Lane G — signatures (owner names; agent prepares).** Six role holders sign
  the canonical payloads from `release:prepare-approval`.

### Phase 7 — Gate F join and closure (half a day)

Assemble the Gate F evidence bundle, validate it, write the remaining
section-16 records, and rerun the ledger validator until it reports closure.

### Deliberately still open at the end

Lane H — physical schema contraction, the `AI-02` compatibility mirror and the
`ACT-01` compatibility path — stays blocked until one verified release, restore
proof, the observed retention window and counsel-approved retention classes.
Waiting there is a safety property. `CNV-01` closes without it; its scope
never included physical drops.

## 5. Division of labour

**Owner (complete list):** the D3 hook exemption; engaging counsel; the Google
profile and written confirmation; the device/assistive-technology pass; naming
six signatories and acting as section-16 reviewer; approvals at exactly four
points — merge, the Lane B batch plan, promotion, and any spend the plan review
surfaces.

**Agent:** everything else — all repository work, all Railway execution under
D4, all evidence production, importing, and validation, and the drafting of the
ADR 0059 ratification and counsel package.

## 6. Timeline

Everything under direct control is ~5–8 working days to "frozen, deployed to
`cell-us`, repository-verified, Railway lanes closed." Full 42/42 formal
closure lands when counsel, the device pass and the signatures do — which is
why Lane A starts on day one rather than after Phase 5.

## 7. What this plan still refuses to do

Unchanged from v1, and restated because the endgame is where the pressure to
break them arrives: no manufactured, simulated or inferred external evidence;
no second data cell; no dark-capability activation as a side effect; no
engineering self-approval of a legal gate; no physical contraction before Lane
H opens; no presentation of a package as closed on fewer than all three axes.
