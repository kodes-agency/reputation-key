// BQC-6.9 — e2e-facing entry point for the flaky-test quarantine register.
// The register data + policy live in src/shared/testing/quarantine-register.ts
// (kept in src so the vitest unit project can guard it — e2e files are
// outside the vitest include and outside the ESLint test-helpers boundary).

export {
  QUARANTINE_REGISTER,
  type QuarantineEntry,
} from '../../src/shared/testing/quarantine-register'
