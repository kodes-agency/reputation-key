export const AI_ADMISSION_RUNTIME_SECRET_NAMES = Object.freeze([
  'AI_CONTROL_DATABASE_URL',
  'AI_CONTROL_DATABASE_CA_B64',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
] as const)

type AdmissionRuntimeSecretName = (typeof AI_ADMISSION_RUNTIME_SECRET_NAMES)[number]
export type AiAdmissionRuntimeSecrets = Record<AdmissionRuntimeSecretName, string>

export function consumeAiAdmissionRuntimeSecrets<Result>(
  environment: Record<string, string | undefined>,
  consumer: (secrets: AiAdmissionRuntimeSecrets) => Result,
): Result {
  const consumed = {} as AiAdmissionRuntimeSecrets
  try {
    for (const name of AI_ADMISSION_RUNTIME_SECRET_NAMES) {
      const value = environment[name]
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`required AI admission setting is missing: ${name}`)
      }
      consumed[name] = value
    }
    return consumer(consumed)
  } finally {
    for (const name of AI_ADMISSION_RUNTIME_SECRET_NAMES) {
      delete environment[name]
      if (name in consumed) consumed[name] = ''
    }
  }
}
