export const GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES = Object.freeze([
  'DATABASE_URL',
  'GOOGLE_ADMISSION_DATABASE_CA_B64',
  'REDIS_URL',
  'GOOGLE_ADMISSION_GRANT_HMAC_KEYS',
] as const)

type RuntimeSecretName = (typeof GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES)[number]
export type GoogleAdmissionRuntimeSecrets = Record<RuntimeSecretName, string>

export function consumeGoogleAdmissionRuntimeSecrets<Result>(
  environment: Record<string, string | undefined>,
  consumer: (secrets: GoogleAdmissionRuntimeSecrets) => Result,
): Result {
  const consumed = {} as GoogleAdmissionRuntimeSecrets
  try {
    for (const name of GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES) {
      const value = environment[name]
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`required Google admission setting is missing: ${name}`)
      }
      consumed[name] = value
    }
    return consumer(consumed)
  } finally {
    for (const name of GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES) {
      delete environment[name]
      if (name in consumed) consumed[name] = ''
    }
  }
}
