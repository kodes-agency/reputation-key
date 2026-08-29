import { describe, expect, it } from 'vitest'
import { validateAuthorityShape } from './check-technology-stack'

/**
 * Characterisation coverage for the authority-shape validator. The production
 * authority file is well formed, so the failure branches are otherwise only
 * reachable through a deliberately malformed document.
 */
describe('validateAuthorityShape', () => {
  it('rejects a non-object document without inspecting any section', () => {
    expect(validateAuthorityShape('not-an-object')).toEqual([
      'technology-stack authority must be an object',
    ])
    expect(validateAuthorityShape(['row'])).toEqual([
      'technology-stack authority must be an object',
    ])
  })

  it('reports every section violation of an empty document in a stable order', () => {
    expect(validateAuthorityShape({})).toEqual([
      'technology-stack authority version must be 1',
      'reviewedAt must be a non-empty string',
      'nextReviewBy must be a non-empty string',
      'technology-stack authority requires named owners',
      'technology-stack authority requires runtime',
      'runtime.nodeVersion must be a non-empty string',
      'runtime.nodeTypeSurfaceVersion must be a non-empty string',
      'runtime.packageManager must be a non-empty string',
      'runtime.packageManagerVersion must be a non-empty string',
      'runtime.runtimePackageManifest must be a non-empty string',
      'runtime.containerPolicy must be a non-empty string',
      'technology-stack authority requires package rows',
      'technology-stack authority requires externalContainerBases',
      'technology-stack authority requires githubActions',
    ])
  })

  it('reports malformed rows for every collection section', () => {
    expect(
      validateAuthorityShape({
        version: 2,
        reviewedAt: '2026/01/01',
        nextReviewBy: '2020-01-01',
        owners: { platform: '', release: 'release-owner' },
        runtime: {
          nodeVersion: '22.23.2',
          nodeTypeSurfaceVersion: '22.19.0',
          packageManager: 'pnpm',
          packageManagerVersion: '10.20.0',
          runtimePackageManifest: 'package.json',
          containerPolicy: 'security/container-image-policy.json',
        },
        packages: [
          'row',
          { package: 'zod', section: 'peerDependencies', version: '^4.4.3', role: 'x' },
          { package: 'zod', section: 'dependencies', version: '4.4.3', role: 'x' },
        ],
        externalContainerBases: [
          'row',
          {
            reference: 'node:22-slim',
            runtimeVersion: '',
            owner: 'platform',
            updateMonitor: '',
          },
        ],
        githubActions: [
          'row',
          { repository: 'actions/checkout', ref: 'v5', displayVersion: '5.0.0' },
          {
            repository: 'actions/checkout',
            ref: 'b'.repeat(40),
            displayVersion: 'v5.0.0',
          },
        ],
        exceptions: [
          'row',
          {
            id: 'x-1',
            scope: 'scope',
            owner: 'unknown-owner',
            expiresOn: '2020/01/01',
            reason: 'reason',
          },
          {
            id: 'x-1',
            scope: 'scope',
            owner: 'release-owner',
            expiresOn: '2020-01-01',
            reason: 'reason',
          },
        ],
      }),
    ).toEqual([
      'technology-stack authority version must be 1',
      'reviewedAt must use YYYY-MM-DD',
      `technology-stack authority review expired on 2020-01-01`,
      'owners.platform must be a non-empty string',
      'packages[0] must be an object',
      'packages[1].section is invalid',
      'packages[1].version must be exact',
      'duplicate package authority zod',
      'externalContainerBases[0] must be an object',
      'externalContainerBases[1].reference must be digest-pinned',
      'externalContainerBases[1].runtimeVersion must be a non-empty string',
      'externalContainerBases[1].updateMonitor must be a non-empty string',
      'githubActions[0] must be an object',
      'actions/checkout ref must be a full SHA',
      'actions/checkout displayVersion must start with v and a digit',
      'duplicate action authority actions/checkout',
      'exceptions[0] must be an object',
      'stack exception x-1 has unknown owner unknown-owner',
      'stack exception x-1 expiry must use YYYY-MM-DD',
      'duplicate stack exception x-1',
      'stack exception x-1 expired on 2020-01-01',
    ])
  })

  it('reports a duplicate package authority row', () => {
    const violations = validateAuthorityShape({
      version: 1,
      reviewedAt: '2026-01-01',
      nextReviewBy: '2099-01-01',
      owners: { platform: 'platform-owner' },
      runtime: {
        nodeVersion: '22.23.2',
        nodeTypeSurfaceVersion: '22.19.0',
        packageManager: 'pnpm',
        packageManagerVersion: '10.20.0',
        runtimePackageManifest: 'package.json',
        containerPolicy: 'security/container-image-policy.json',
      },
      packages: [
        { package: 'zod', section: 'dependencies', version: '4.4.3', role: 'x' },
        { package: 'zod', section: 'dependencies', version: '4.4.3', role: 'x' },
      ],
      externalContainerBases: [],
      githubActions: [
        {
          repository: 'actions/checkout',
          ref: 'b'.repeat(40),
          displayVersion: 'v5.0.0',
        },
      ],
      exceptions: [],
    })

    expect(violations).toEqual(['duplicate package authority zod'])
  })
})
