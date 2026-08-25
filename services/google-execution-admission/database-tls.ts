import {
  loadPinnedPostgresTlsConfiguration,
  type PinnedPostgresTlsConfiguration,
} from '../postgres-database-tls'

export type GoogleAdmissionDatabaseTlsConfiguration = PinnedPostgresTlsConfiguration

export function loadGoogleAdmissionDatabaseTlsConfiguration(
  input: Readonly<{
    connectionString: string
    caBase64: string
  }>,
): GoogleAdmissionDatabaseTlsConfiguration {
  return loadPinnedPostgresTlsConfiguration({
    ...input,
    invalidMessage: 'Google execution-admission database TLS configuration is invalid',
  })
}
