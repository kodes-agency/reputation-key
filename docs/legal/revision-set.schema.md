# Release legal artifacts — schema reference

Status: engineering reference. Not legal advice and not a counsel decision.

Two artifacts gate an external beta on the legal side, and Gate F requires
both. They answer different questions, which is why neither replaces the other.

| Artifact                         | Question it answers                                                                       | Schema                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `release.legalRevisionSet`       | _Which exact bytes did counsel approve?_                                                  | `repkey-legal-revision-set-1` — `src/shared/release/legal-revision-set-evidence.ts`    |
| `release.legalApprovalChecklist` | _Did counsel decide the facts those bytes depend on, and is that decision still current?_ | `repkey-legal-approval-checklist-1` — `src/shared/release/legal-approval-checklist.ts` |

A revision set on its own can be complete, digest-matched and current while the
transfer mechanism, the retention classes and the Google confirmation expiry are
all still open questions in `docs/legal/counsel-decision-checklist.json`. Gate F
would have passed on it. The checklist closes that gap.

## `repkey-legal-revision-set-1`

Produced by `pnpm release:create-legal-revision-set`. See the module header for
the full contract. In summary it carries the release candidate binding, the
legal document registry digest, and one entry per counsel-owned document and
in-product notice, each mirroring its registry row exactly. Every entry must be
`approved`, approved by an `external_counsel` role, and current at capture.

## `repkey-legal-approval-checklist-1`

### Per-document fields

Required for each of `docs/legal/privacy-notice.md`,
`docs/legal/internal-beta-agreement.md` and
`docs/legal/google-access-disclosure.md`:

| Field         | Meaning                                       |
| ------------- | --------------------------------------------- |
| `documentId`  | Registry id (`privacy-notice`, …)             |
| `path`        | Repository-relative path; pinned per document |
| `versionId`   | The version counsel approved                  |
| `sha256`      | Must equal the ON-DISK digest of that file    |
| `effectiveAt` | Start of the approval window                  |
| `reviewAt`    | When counsel next reviews the text            |
| `expiresAt`   | End of the approval window                    |

The digest is re-computed from the bytes in the checkout at validation time, so
an edit after approval invalidates the approval instead of silently inheriting
it. A document still carrying a draft marker (`Candidate draft`,
`do not publish`, `not for publication`) is rejected.

### Required LEG-01 fact keys

Every key must be present with `decided: true`, a decision sentence, a decider
and a decision date no later than `approvedAt`. There is no default and no
"assumed" state — a missing key and an undecided key are both rejections.

| Fact key                               | Source category in `counsel-decision-checklist.json` |
| -------------------------------------- | ---------------------------------------------------- |
| `controller_processor_roles`           | `roles`                                              |
| `lawful_bases`                         | `lawful_bases`                                       |
| `dpia_ccpa_decision`                   | `dpia_and_regions`                                   |
| `retention_classes`                    | `retention_classes`                                  |
| `data_subject_rights`                  | `rights`                                             |
| `subprocessors`                        | `processors_and_transfers`                           |
| `regions_and_transfers`                | `processors_and_transfers`                           |
| `google_confirmation_scope`            | `google_terms_and_expiry`                            |
| `google_confirmation_conditions`       | `google_terms_and_expiry`                            |
| `google_confirmation_expiry`           | `google_terms_and_expiry`                            |
| `google_confirmation_monitoring_owner` | `google_terms_and_expiry`                            |
| `employee_metrics_framing`             | `staff_metrics`                                      |
| `beta_support_commitment`              | `support_terms`                                      |

### Approval window and staleness

`counselIdentity`, `counselOrganization` and `approvedAt` are required.
`approvedAt` must fall inside `[effectiveAt, expiresAt]`, and Gate F separately
rejects a bundle whose checklist `expiresAt` precedes its `completedAt`. A
stale approval is not an approval.

### Binding

`legalRevisionSetSha256` must equal the digest of the `release.legalRevisionSet`
reference in the same Gate F index, and the counsel and founder approval
envelopes must sign that same digest. Engineering identities cannot satisfy the
counsel role: the role is part of the signed payload and counsel's enrolled
public key in `security/gate-f-approval-roles.json` is the only key that
verifies for it.

### Why the document reader is injected

`src/shared/release` is compiled with the application and must not reach the
filesystem. `parseLegalApprovalChecklist` therefore takes a reader and fails
CLOSED when none is supplied: a checklist whose documents may have changed since
approval must be rejected, not trusted on its own numbers.
`pnpm release:validate-evidence` supplies a path-contained reader.
