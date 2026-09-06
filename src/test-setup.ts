import { beforeAll, beforeEach } from 'vitest'
import '#/shared/auth/permissions'
import { resetEnv } from '#/shared/config/env'

/**
 * Container construction validates several provider/security groups in all-or-none mode.
 * Unit tests that call createContainer with operator-like host envs must scrub these.
 */
const TEST_CONTAINER_ENV_KEYS: readonly string[] = [
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

const clearTestContainerEnv = (): void => {
  for (const key of TEST_CONTAINER_ENV_KEYS) {
    delete process.env[key]
  }
}

clearTestContainerEnv()
resetEnv()

beforeAll(() => {
  clearTestContainerEnv()
  resetEnv()
})

beforeEach(() => {
  clearTestContainerEnv()
  resetEnv()
})
