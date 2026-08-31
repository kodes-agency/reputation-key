# Review lifecycle recovery approval

This procedure is the restore-only approval boundary for Review source-content
erasure. It does not activate the recurring production lifecycle and it does
not attest that a Railway restore drill has passed.

The ordinary application, web process, worker, and recurring lifecycle remain
unable to apply Review erasure. Only `ops:restore-verify`, running against an
attested isolated restore target, can compose the sealed executor, and only
when all three `REVIEW_LIFECYCLE_RECOVERY_APPROVAL_*` values are present and
valid.

## What is approved

One approval request binds all of the following:

- the 40-character release SHA and signed release-manifest SHA-256;
- the exact Data Cell, provider restore point, restored database service,
  Railway project, and Railway environment;
- a pre-generated recovery run UUID and the next cell recovery generation;
- `review-source-content-lifecycle-v1`, global `expired` scope, the frozen
  evaluation instant, and the fixed maximum batch size of 100;
- the source-content and retention policy versions, complete policy digest,
  and aggregate report digest.

The report contains counts and comparison findings only. It contains no Review,
Organization, Property, provider-resource, rating, text, or Reply identifiers.

Migration `0150_review_lifecycle_recovery_execution` stores a one-shot,
content-free receipt. It retains the approved report's expired-row count plus
aggregate page/redaction counts and, while work remains, only the last
`(createdAt, ReviewId)` cursor. Database triggers make the signed binding and
completed evidence durable, reject deletion/truncation, bound every page to at
most 100 scanned rows, and permit only the forward
`applying → lifecycle_applied → completed` progression.

## Prepare the request

1. Complete restore containment, target attestation, and migration parity in
   [backup-and-lifecycle](backup-and-lifecycle.md). Keep the worker down and
   every effect capability denied.
2. Set the restore target variables, but leave all three
   `REVIEW_LIFECYCLE_RECOVERY_APPROVAL_*` variables unset.
3. Run `pnpm ops:restore-verify --operator <id>`. The dry run drains both the
   full Review report and shadow views at one frozen instant. It prints:
   - the canonical aggregate report and its SHA-256;
   - the canonical approval request and its SHA-256; and
   - the other retention, import, recovery-authority, and Data Cell move
     inventories.
4. Save those exact one-line canonical JSON artifacts in the controlled change
   record. A later dry run creates a different recovery UUID and is a new
   request; approve only the artifact intended for the apply attempt.
5. Stop if there is an unresolved Data Cell move, unexplained shadow finding,
   wrong target identity, or unreviewed policy/version change. Do not edit the
   request by hand and do not infer a missing value.

Preparation reads the restore database and writes only the normal operator
policy-decision audit. It creates no recovery receipt and applies no lifecycle
page or recovery fence.

## Independent approval bundle

The independent approver verifies the saved report, target, policy versions,
and request digest. Approval is explicit; absence or a `denied` decision can
never be interpreted as approval.

The bundle format is `review-lifecycle-recovery-approval-v1`:

```json
{
  "request": "the exact request object printed by the dry run",
  "requestSha256": "SHA-256 of the RFC 8785 canonical request bytes",
  "approval": {
    "approvalId": "a unique controlled-change identifier",
    "decision": "approved",
    "approverIdentity": "the named reviewer identity",
    "keyId": "the trusted Ed25519 key identifier",
    "approvedAt": "an ISO-8601 instant at or after evaluatedAt",
    "expiresAt": "an ISO-8601 instant no more than 24 hours later",
    "requestSha256": "the same request digest",
    "signature": "canonical base64 Ed25519 signature"
  }
}
```

The Ed25519 signature covers the RFC 8785 canonical bytes of the `approval`
object without its `signature` field and without a trailing newline. The signed
object carries the exact request digest. Assemble the final bundle as RFC 8785
canonical JSON with one final newline, then compute SHA-256 over those exact
bundle bytes, including that newline.

The trusted keyring is a JSON object mapping `keyId` to canonical base64 SPKI
DER bytes for the independently held Ed25519 public key. One to four keys are
accepted; a key declared by the bundle itself is never trusted. Private keys
must stay outside Railway and outside the repository.

Configure these three values together, only for the isolated verifier process:

- `REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON` — exact canonical bundle
  bytes, including the final newline;
- `REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256` — digest of those exact
  bytes;
- `REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON` — trusted public
  keyring.

## Apply and recover

Run the typed destructive command from the same isolated target:

```text
pnpm ops:restore-verify --operator <id> --reason <change-ref> --apply --yes ops:restore-verify
```

Before its first mutation, the executor checks canonical encoding, bundle and
request digests, `approved`, approval time window, trusted key, Ed25519
signature, every runtime target field, every policy field, and a freshly
re-collected report digest. It then reserves the exact one-shot receipt.

Apply drains only checkpointed pages of at most 100 rows through the Review
context's existing transaction-owned lifecycle store. Each page's Review
redactions, aggregate receipt counters, and next cursor commit in the same
PostgreSQL transaction. A failed transaction advances neither the Review rows
nor the receipt. It next runs the bounded import and retention reconciliation,
applies the pre-reviewed recovery run/generation, proves zero remaining
authority, and completes the receipt. The output contains only aggregate
counts and approval/report/recovery IDs and digests.

If the process stops after reserving, between Review pages, or after Review
lifecycle completion, rerun with the exact same bundle while it is still
valid. An existing exact receipt resumes from its durable cursor without
re-collecting the pre-apply report: prior pages have intentionally erased that
source content, while the immutable receipt already anchors the approved
report digest and count. The recovery fence converges on the exact run and
generation. A completed approval, changed bundle, new approval ID, changed
target, stale generation, stale/expired approval, or mismatched durable binding
is refused. If the approval expires before safe completion, stop and use
incident review; do not manufacture a replacement authority for the partially
completed run.

Remove all three approval variables before any serving or worker cutover. Pin
only the verifier's completed `RECOVERY_CUTOVER_RUN_ID` and
`RECOVERY_CUTOVER_GENERATION` as described in the restore procedure.

## Evidence boundary

Repository unit and disposable-PostgreSQL tests prove the local validation,
one-shot receipt, bounded apply, atomic page/cursor rollback, exact recovery
binding, and refusal paths. They are not production report evidence, a provider
backup attestation, a Railway restore/cutover result, or recurring lifecycle
activation approval.
