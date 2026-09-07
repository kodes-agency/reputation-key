/**
 * Container construction validates several provider/security groups in
 * all-or-none mode. A test that calls `createContainer` on an operator-like
 * host environment must scrub these first; nothing else reads them, so the
 * scrub is opt-in per file rather than a global setup step.
 */
export const TEST_CONTAINER_ENV_KEYS: readonly string[] = [
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
  'AI_KEY_INVENTORY_PROFILE',
  'AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON',
  'AI_SUBJECT_HMAC_KEYS',
  'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
  'GOOGLE_CONTROL_PLANE_POLICY_GENERATION',
  'GOOGLE_EGRESS_GATEWAY_ORIGIN',
  'GOOGLE_EGRESS_GATEWAY_SERVER_NAME',
  'GOOGLE_INTERNAL_MTLS_CA_PATH',
  'GOOGLE_INTERNAL_MTLS_CERT_PATH',
  'GOOGLE_INTERNAL_MTLS_KEY_PATH',
  'GOOGLE_INTERNAL_MTLS_CA_B64',
  'GOOGLE_INTERNAL_MTLS_CERT_B64',
  'GOOGLE_INTERNAL_MTLS_KEY_B64',
  'GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON',
  'REVIEW_PROVIDER_SUBJECT_HMAC_KEYS',
  'REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS',
] as const

export function clearTestContainerEnv(): void {
  for (const key of TEST_CONTAINER_ENV_KEYS) {
    delete process.env[key]
  }
}
