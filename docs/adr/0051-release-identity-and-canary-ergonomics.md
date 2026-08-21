---
status: accepted
date: 2026-08-21
---

# 0051 — Release identity and canary ergonomics

## Context

Deploying `main` to the `google-closed-beta` Railway environment on 2026-08-21
cost two avoidable failures, both caused by release-gate ergonomics rather than
by any defect in the application. The gates themselves are sound; the way an
operator is required to drive them is not, and the failure modes are silent or
destructive.

**1. Release identity is two coupled variables with no coupled operation.**
`assertReleaseIdentity` (`src/shared/config/release-identity.ts`) refuses a
production boot when `RELEASE_SHA !== IMAGE_SOURCE_REVISION`. `RELEASE_SHA` is a
Railway service variable. `IMAGE_SOURCE_REVISION` is baked at build time from the
`SOURCE_REVISION` Docker `ARG` (`Dockerfile:2,95-97`), which Railway supplies
from a _separate_ service variable of the same name. Nothing moves them together
and nothing warns when they diverge.

The closed-beta runbook documents `railway variables --set RELEASE_SHA=…`
followed by `railway up`. Following it exactly produced a `web` image whose baked
revision was the previous release, an immediate boot refusal, a `FAILED`
deployment, and a **crashed worker**. The error text is deliberately value-free
so it is safe to paste into tickets, which also means it names neither variable
and gives the operator nothing to correct.

**2. The AI canary gate can only be exercised by taking AI down.**
`issue_ai_canary_authorization_v1` (`drizzle/0067_ai-model-luna-switch.sql`)
refuses to issue unless `review_analysis`, `reply_drafting` and `property_trends`
are all `killed`/`draining`. `transition_ai_execution_control_v1` then refuses to
restore a capability without a `passed` canary head for the candidate release
SHA.

That ordering is correct for its designed purpose — activating a release whose
capabilities are off. It is actively harmful for the far more common case of
redeploying a healthy AI plane: the only way to run the ceremony is to kill three
working capabilities first, and if the canary then fails, they stay killed. The
gate therefore punishes the operator for exercising it, and the safe path — skip
the ceremony — is the one that leaves no canary head for the running release, so
a later emergency restore has no authorization to reference.

Capability heads are scope-keyed (`ai_execution_control_heads.scope_key`), not
release-keyed, and runtime dispatch does not compare the running `RELEASE_SHA`
against them. Only `restore` does. This was verified against the live closed
beta: after moving all six services to a new release SHA, all three capability
heads remained `enabled`/`accepting` and a real `reply` operation settled
`success` with live provider token usage.

## Decision

1. **Release identity moves as one operation.** `RELEASE_SHA` and
   `SOURCE_REVISION` are one fact with two names. Any procedure, script or
   runbook that sets one MUST set the other in the same step, for every service
   in the environment. A deploy that sets only one is a defect in the procedure,
   not operator error.
2. **`assertReleaseIdentity` must name the divergence.** The refusal is allowed
   to omit revision _values_; it MUST NOT omit which two variables disagree and
   which knob fixes it. A guard that fails closed without naming its own inputs
   converts a one-line fix into a log-archaeology exercise.
3. **A routine redeploy of a healthy AI plane does not run the canary
   ceremony.** Moving the AI services to a new release SHA while all capability
   heads are `enabled` is an ordinary deploy. Operators MUST NOT kill working
   capabilities in order to satisfy an activation gate. The canary is an
   activation control, not a deploy control.
4. **The gate's precondition is documented at the point of use.** The
   `killed`/`draining` requirement is discoverable today only by reading a SQL
   function body, after the CLI has already answered `not eligible for issue`.
   That message MUST state the precondition.
5. **Governance constants stay pinned; only the ergonomics move.** Nothing here
   relaxes the exact-value `E2E` hatch, the Google content approval runtime
   binding, the byte-attested language wrappers, the `openai` SDK pin, or the
   provider/catalogue digests. Those caught three real supply-chain and
   deployment defects on 2026-08-21 and remain first-deny.

## Consequences

- Deploy procedures are rewritten to set both revision variables per service.
  `docs/operations/closed-beta-release-runbook-2026-08-19.md` §2 is superseded on
  this point.
- A release deployed without a canary head has no `restore` path until one is
  issued. That is an accepted trade: it is strictly better than an outage taken
  to manufacture one, and issuing a canary remains available whenever the plane
  is deliberately being activated.
- `emergency_kill_version` and the capability `denied` flag remain the immediate
  controls for stopping AI. Neither depends on a canary.
- Deliberately unchanged: the canary's own strictness. When it does run, its
  exact-allowlist environment and strict claim parser stay as they are; four real
  defects were found through them.

## Required evidence

- Every service in a release reports the same `RELEASE_SHA`, and each service's
  baked `IMAGE_SOURCE_REVISION` equals it.
- After a redeploy, `ai_execution_control_heads` shows every scope
  `enabled`/`accepting`, and one real operation settles with `usage_known = true`.
