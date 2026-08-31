import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

const ci = read('.github/workflows/ci.yml')
const compose = read('compose.local.yml')
const admissionDockerfile = read('Dockerfile.google-execution-admission')
const gatewayDockerfile = read('Dockerfile.google-egress-gateway')
const gatewayBuild = read('tsup.google-egress-gateway.config.ts')

const GOOGLE_IMAGES = [
  'repkey-google-execution-admission:ci',
  'repkey-google-egress-gateway:ci',
] as const

describe('Google sidecar production artifacts', () => {
  it('ships minimal non-root bundles with exact production commands', () => {
    expect(admissionDockerfile).toContain('USER node')
    expect(admissionDockerfile).toContain(
      'CMD ["node", "dist-google-execution-admission/index.js"]',
    )
    expect(gatewayDockerfile).toContain('USER node')
    expect(gatewayDockerfile).toContain(
      'CMD ["node", "dist-google-egress-gateway/index.js"]',
    )
    for (const dockerfile of [admissionDockerfile, gatewayDockerfile]) {
      expect(dockerfile).not.toMatch(/COPY --from=.*node_modules/u)
      expect(dockerfile).not.toMatch(/^COPY package\.json \.\/$/mu)
      expect(dockerfile).toContain('verify-google-runtime-bundle.mjs')
    }
  })

  it('build-isolates local relays from the production gateway target', () => {
    expect(gatewayBuild).not.toMatch(/control-proxy|tcp-relay/u)
    expect(gatewayDockerfile).toContain('FROM runtime AS local-tools')
    expect(gatewayDockerfile.trimEnd()).toMatch(/FROM runtime AS production$/u)
    expect(compose).toMatch(
      /google-egress-gateway:[\s\S]*?dockerfile: Dockerfile\.google-egress-gateway\n\s+target: local-tools/u,
    )
  })

  it('builds, smoke-checks, digests, inventories, and scans both images in CI', () => {
    for (const image of GOOGLE_IMAGES) {
      expect(ci).toContain(`-t ${image}`)
      expect(ci).toContain(`docker image inspect ${image}`)
      expect(ci).toContain(`image: ${image}`)
    }
    expect(ci).toContain('dist-google-execution-admission')
    expect(ci).toContain('dist-google-egress-gateway')
    expect(ci).toContain('sbom-google-execution-admission.spdx.json')
    expect(ci).toContain('sbom-google-egress-gateway.spdx.json')
    expect(ci).toContain('Vulnerability scan Google execution admission image')
    expect(ci).toContain('Vulnerability scan Google egress gateway image')
  })
})
