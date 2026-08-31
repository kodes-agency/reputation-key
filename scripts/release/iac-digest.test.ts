import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RAILWAY_IAC_SOURCE_PATHS,
  railwayIacSourceDigest,
  sourceTreeDigest,
} from './iac-digest'

const roots: string[] = []

function sourceFixture(): Readonly<{
  root: string
  catalogue: string
  deploymentProfile: string
  projectServiceIsolation: string
}> {
  const root = mkdtempSync(join(tmpdir(), 'repkey-railway-iac-digest-'))
  roots.push(root)
  const contents = new Map([
    ['.railway/railway.ts', 'export const graph = "us"\n'],
    ['src/shared/domain/data-cell-catalogue.ts', 'export const region = "us-west2"\n'],
    [
      'src/shared/release/railway-deployment-profile.ts',
      'export const profiles = ["production", "rehearsal"]\n',
    ],
    [
      'src/shared/release/railway-project-service-isolation.ts',
      'export const isolatedServices = ["web", "worker"]\n',
    ],
  ])
  for (const [path, content] of contents) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return {
    root,
    catalogue: join(root, 'src/shared/domain/data-cell-catalogue.ts'),
    deploymentProfile: join(root, 'src/shared/release/railway-deployment-profile.ts'),
    projectServiceIsolation: join(
      root,
      'src/shared/release/railway-project-service-isolation.ts',
    ),
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Railway IaC source digest', () => {
  it('binds placement, deployment-profile, and service-isolation policies', () => {
    expect(RAILWAY_IAC_SOURCE_PATHS).toEqual([
      '.railway',
      'src/shared/domain/data-cell-catalogue.ts',
      'src/shared/release/railway-deployment-profile.ts',
      'src/shared/release/railway-project-service-isolation.ts',
    ])
    expect(railwayIacSourceDigest()).toMatch(/^[0-9a-f]{64}$/u)

    const fixture = sourceFixture()
    const paths = RAILWAY_IAC_SOURCE_PATHS.map((path) => join(fixture.root, path))
    const baseline = sourceTreeDigest(paths)

    writeFileSync(fixture.catalogue, 'export const region = "us-east4"\n')
    expect(sourceTreeDigest(paths)).not.toBe(baseline)

    writeFileSync(fixture.catalogue, 'export const region = "us-west2"\n')
    writeFileSync(fixture.deploymentProfile, 'export const profiles = ["production"]\n')
    expect(sourceTreeDigest(paths)).not.toBe(baseline)

    writeFileSync(
      fixture.deploymentProfile,
      'export const profiles = ["production", "rehearsal"]\n',
    )
    writeFileSync(
      fixture.projectServiceIsolation,
      'export const isolatedServices = ["web"]\n',
    )
    expect(sourceTreeDigest(paths)).not.toBe(baseline)
  })
})
