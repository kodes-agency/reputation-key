import {
  loadPinnedPostgresTlsConfiguration,
  type PinnedPostgresTlsConfiguration,
} from '../postgres-database-tls'

export type AiControlDatabaseTlsConfiguration = PinnedPostgresTlsConfiguration

export function loadAiControlDatabaseTlsConfiguration(
  input: Readonly<{
    connectionString: string
    caBase64: string
  }>,
): AiControlDatabaseTlsConfiguration {
  return loadPinnedPostgresTlsConfiguration({
    ...input,
    invalidMessage: 'AI admission control database TLS configuration is invalid',
  })
}
