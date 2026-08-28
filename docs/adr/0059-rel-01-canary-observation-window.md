---
status: proposed
date: 2026-08-28
---

# 0059 — REL-01 canary observation window and threshold profile

## Context

`REL-01` Promotion step 4 requires the operator to "observe the defined canary
window and operational thresholds" before the candidate is opened to the beta
cohort. `src/shared/release/canary-window-evidence.ts` has encoded the _shape_
of that proof since it was written — `repkey-canary-window-1` embeds a
`repkey-canary-threshold-profile-1` that must name nine signal categories, must
reconcile expected/observed/missing samples per signal, and refuses a pass when
any sample is missing or breached.

What has never existed is the decision the shape depends on. The schema requires
`durationMs`, `approvedBy` and `approvedAt`, but no repository authority states
how long the window is or who ratified it. A sampler therefore has nothing to
bind: any executable observer would have had to invent a duration, and an
invented duration is indistinguishable in the emitted artifact from an agreed
one. The 2026-08-28 REL-01 audit recorded this as gap R3.

Two facts constrain how this ADR may close that gap.

1. The nine signal categories and their authoritative sources are already
   decided in code (`CANARY_REQUIRED_SIGNAL_CATEGORIES` and the per-category
   source allow-list). This ADR records them, it does not invent them.
2. The observation _duration_ is an operating commitment, not an engineering
   detail. It trades exposure of the first cohort against confidence, and it
   binds whoever is on call for the window. Engineering cannot ratify its own
   release gate; the same separation this repository already enforces for legal
   approval applies here.

## Decision

1. `security/rel-01-canary-threshold-profile.json` is the single repository
   authority for the canary threshold profile. It is a
   `repkey-canary-threshold-profile-authority-1` document, and this ADR is its
   decision record: the profile carries the sha256 of this file, so an edit to
   this ADR invalidates the profile until it is re-ratified.

2. The profile declares exactly nine signals, one per required category, in
   canonical `localeCompare` name order, each bound to a source this document
   authorises:

   | Signal                             | Category                | Source                | Comparator | Threshold                           | Sample interval |
   | ---------------------------------- | ----------------------- | --------------------- | ---------- | ----------------------------------- | --------------- |
   | `canary-application-readiness`     | `application_health`    | `application_metrics` | `eq`       | `0` degraded sections               | 60s             |
   | `canary-error-rate`                | `error_rate`            | `sentry`              | `eq`       | `0` unresolved new issues           | 60s             |
   | `canary-external-availability`     | `external_availability` | `external_synthetic`  | `eq`       | `0` failed synthetic probes         | 60s             |
   | `canary-latency-probe-duration`    | `latency`               | `external_synthetic`  | `lte`      | `1500` ms                           | 60s             |
   | `canary-platform-recovery`         | `platform_recovery`     | `railway_platform`    | `eq`       | `0` unplanned restarts              | 300s            |
   | `canary-privacy-prohibited-fields` | `privacy`               | `application_metrics` | `eq`       | `0` prohibited-field occurrences    | 60s             |
   | `canary-provider-control-heads`    | `provider_controls`     | `provider_control`    | `eq`       | `0` disabled or non-accepting heads | 60s             |
   | `canary-queue-outbox-backlog`      | `queue_outbox`          | `application_metrics` | `eq`       | `0` stalled outbox rows             | 60s             |
   | `canary-release-drift`             | `release_drift`         | `release_controller`  | `eq`       | `0` identity mismatches             | 60s             |

   Each signal also carries a `valuePointer`: the JSON pointer the observer
   reads out of that source's response body. A pointer is a read instruction,
   not a threshold, so it is ratified together with the duration. A pointer that
   does not resolve to a finite number records a **missing** sample, which fails
   the window; it never records a pass.

   Every threshold above is a _zero-tolerance_ count except latency, which is a
   bound. This is deliberate: a canary window that tolerates a non-zero rate has
   to argue about the rate. Nothing in the profile may be relaxed by the
   observer at run time — the sampler reads it, it does not negotiate it.

3. **OPEN DECISION — observation window duration.** `durationMs` is _not_
   decided by this ADR. It must be ratified by an operating owner (the named
   owner accountable for the beta on-call rotation), who records the agreed
   duration, their identity and the ratification timestamp in the profile's
   `ratification` block. Engineering authorship of this ADR is not ratification;
   an author who is also the operating owner must still record the ratification
   explicitly and dated, so the approval is auditable as a separate act.

4. Until step 3 happens the profile stays in `ratification.state: "open"`.
   `parseCanaryThresholdProfile` returns an open authority with **no usable
   profile**, and `pnpm release:observe-canary` exits non-zero naming the open
   decision. There is no default duration and no override flag. A window that
   nobody agreed to is a closed gate, not a short window.

5. A ratification whose `approvedBy` is a placeholder identity, or whose
   `approvedAt` lies in the future, is rejected by the parser. Self-approval by
   an engineering identity is refused for the same reason the legal path refuses
   it: the approver must be the accountable operator, not the producer.

## Consequences

- Gate F's `promotion.canary_window` key stays closed until an operating owner
  ratifies the duration. That is the honest state; it is not a regression
  introduced by this ADR, it is the pre-existing gap made explicit and
  executable.
- The threshold table above is repository authority. Adding a tenth signal, or
  moving a signal to a different source, requires editing this ADR — which
  changes its digest and forces re-ratification of the profile.
- The sampler cannot fabricate. Signals whose source it cannot reach are refused
  before any artifact is written, and an unreachable read is recorded as a
  _missing_ sample that fails the window, never as an absent one.

## Ratification checklist for the operating owner

1. Choose `durationMs` and state the reasoning in the change record.
2. Set `security/rel-01-canary-threshold-profile.json` `ratification` to
   `{"state":"ratified","durationMs":<ms>,"approvedBy":"<operating owner>","approvedAt":"<ISO-8601 UTC>"}`.
3. Re-run `pnpm test -- src/shared/release/canary-threshold-profile.test.ts`;
   the digest binding test proves the profile still matches this ADR.
