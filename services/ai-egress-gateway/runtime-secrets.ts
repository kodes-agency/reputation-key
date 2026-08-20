export const AI_GATEWAY_RUNTIME_SECRET_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_SAFETY_IDENTIFIER_HMAC_KEYS',
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
  'AI_PROVENANCE_ED25519_PRIVATE_KEY_B64',
] as const)

export const AI_CANARY_RUNTIME_SECRET_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
] as const)

type GatewayRuntimeSecretName = (typeof AI_GATEWAY_RUNTIME_SECRET_NAMES)[number]
export type AiGatewayRuntimeSecrets = Record<GatewayRuntimeSecretName, string>
type CanaryRuntimeSecretName = (typeof AI_CANARY_RUNTIME_SECRET_NAMES)[number]
export type AiCanaryRuntimeSecrets = Record<CanaryRuntimeSecretName, string>

function consumeRuntimeSecrets<Name extends string, Result>(
  names: readonly Name[],
  environment: Record<string, string | undefined>,
  missingLabel: string,
  consumer: (secrets: Record<Name, string>) => Result,
): Result {
  const consumed = {} as Record<Name, string>
  try {
    for (const name of names) {
      const value = environment[name]
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`required ${missingLabel} setting is missing: ${name}`)
      }
      consumed[name] = value
    }
    return consumer(consumed)
  } finally {
    for (const name of names) {
      delete environment[name]
      if (name in consumed) consumed[name] = ''
    }
  }
}

export function consumeAiGatewayRuntimeSecrets<Result>(
  environment: Record<string, string | undefined>,
  consumer: (secrets: AiGatewayRuntimeSecrets) => Result,
): Result {
  return consumeRuntimeSecrets(
    AI_GATEWAY_RUNTIME_SECRET_NAMES,
    environment,
    'AI gateway',
    consumer,
  )
}

export function consumeAiCanaryRuntimeSecrets<Result>(
  environment: Record<string, string | undefined>,
  consumer: (secrets: AiCanaryRuntimeSecrets) => Result,
): Result {
  return consumeRuntimeSecrets(
    AI_CANARY_RUNTIME_SECRET_NAMES,
    environment,
    'AI canary',
    consumer,
  )
}
