import { describe, expect, it } from 'vitest'
import { resolveSidecarRuntimePorts } from './sidecar-runtime-ports'

describe('sidecar runtime ports', () => {
  it('defaults to an ordinary platform-health port and a distinct mTLS port', () => {
    expect(resolveSidecarRuntimePorts({})).toEqual({
      healthPort: 8080,
      protectedMtlsPort: 8443,
    })
  })

  it('parses explicit bounded ports', () => {
    expect(
      resolveSidecarRuntimePorts({ PORT: '8081', INTERNAL_MTLS_PORT: '9443' }),
    ).toEqual({ healthPort: 8081, protectedMtlsPort: 9443 })
  })

  it.each([
    [{ PORT: '0' }, 'sidecar platform health port is invalid'],
    [{ PORT: '8e3' }, 'sidecar platform health port is invalid'],
    [{ INTERNAL_MTLS_PORT: '65536' }, 'sidecar protected mTLS port is invalid'],
    [
      { PORT: '8443', INTERNAL_MTLS_PORT: '8443' },
      'sidecar platform health port must be distinct from mTLS port',
    ],
  ])('refuses invalid or overlapping ports', (environment, message) => {
    expect(() => resolveSidecarRuntimePorts(environment)).toThrow(message)
  })
})
