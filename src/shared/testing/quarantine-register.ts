// BQC-6.9 — flaky-test quarantine register.
//
// POLICY (binding): a flaky test may be quarantined ONLY with ALL of:
//   - owner         — a named engineer/team accountable for the fix;
//   - reproduction  — how to reproduce the flake (seed, command, CI run link);
//   - expiry        — an ISO 8601 date in the FUTURE by which the test is
//                     either fixed-and-unquarantined or deleted (no permanent
//                     quarantine);
//   - releaseBlocking: false — quarantined tests are non-release by
//                     definition; a release-blocking flow may never sit here.
// No required workflow may remain quarantined: an entry whose testName
// matches a spec in the Playwright CRITICAL project (e2e/critical/**,
// the required-workflow hard gate, BQR-5.1) is rejected by the guard test
// (src/shared/testing/quarantine-register.test.ts).
//
// Quarantining a test also requires skipping it at the source with a pointer
// to the entry — and the skip itself must be registered in
// scripts/check-test-quality.mjs (BQC-6.9 skip register).
//
// The register is EMPTY today — the e2e suite is green with zero
// quarantines (BQC-6.7 promoted the full suite to a hard gate).

export type QuarantineEntry = Readonly<{
  /** Exact Playwright test title (or `file › title`) as it appears in the spec. */
  testName: string
  /** Accountable engineer or team. */
  owner: string
  /** How to reproduce the flake (seed, command, failing CI run). */
  reproduction: string
  /** ISO 8601 date by which the entry is resolved; must be in the future. */
  expiry: string
  /** Always false — a release-blocking test may never be quarantined. */
  releaseBlocking: false
}>

export const QUARANTINE_REGISTER: ReadonlyArray<QuarantineEntry> = [
  // no entries — see the policy header for what a valid entry requires
]
