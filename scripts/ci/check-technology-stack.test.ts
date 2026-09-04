import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadContainerImagePolicy } from './check-container-image-policy'
import {
  loadRuntimeContractSources,
  loadTechnologyStackAuthority,
  validateActionAuthority,
  validateDatabaseGuidance,
  validateDockerBaseAuthority,
  validateMutableCommandSurfaces,
  validatePackageVersions,
  validateRuntimeContractSources,
  validateTechnologyStack,
  type TextSurface,
} from './check-technology-stack'

const ROOT = resolve(import.meta.dirname, '../..')

describe('technology-stack authority', () => {
  it('keeps runtime, packages, actions, containers, and operational contracts aligned', () => {
    expect(validateTechnologyStack(ROOT)).toEqual([])
  })

  it('rejects either broken link in the telemetry sensitive-field authority chain', () => {
    const authority = loadTechnologyStackAuthority(ROOT)
    const sources = loadRuntimeContractSources(ROOT)
    const expected =
      'telemetry must consume the shared sensitive-field authority through sentry-event-scrub'

    for (const drifted of [
      {
        ...sources,
        telemetry: sources.telemetry.replace(
          './sentry-event-scrub',
          './another-scrubber',
        ),
      },
      {
        ...sources,
        sentryEventScrub: sources.sentryEventScrub.replace(
          './sensitive-field-policy',
          './another-policy',
        ),
      },
    ]) {
      expect(validateRuntimeContractSources(authority, drifted)).toContain(expected)
    }
  })

  it('rejects a ranged declaration even when the lockfile still resolves the approved version', () => {
    const authority = loadTechnologyStackAuthority(ROOT)
    const packageManifest = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    const dependencies = packageManifest.dependencies as Record<string, string>
    dependencies.zod = '^4.4.3'

    expect(
      validatePackageVersions(
        authority,
        packageManifest,
        readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8'),
      ),
    ).toContain('zod must be declared exactly as 4.4.3; found ^4.4.3')
  })

  it('rejects network-fetched mutable CLIs at the executable-command seam', () => {
    const surfaces: readonly TextSurface[] = [
      {
        path: 'fixture/workflow.yml',
        content: 'run: npx -y shadcn@latest init',
      },
      {
        path: 'fixture/package.json#scripts.generate',
        content: 'pnpm dlx drizzle-kit generate',
      },
    ]

    expect(validateMutableCommandSurfaces(surfaces)).toEqual([
      'fixture/workflow.yml: mutable CLI invocation uses npx -y',
      'fixture/workflow.yml: mutable package selector uses @latest',
      'fixture/package.json#scripts.generate: mutable CLI invocation uses pnpm dlx',
    ])
  })

  it('rejects an action tag even when its human version comment looks pinned', () => {
    const authority = loadTechnologyStackAuthority(ROOT)

    expect(
      validateActionAuthority(authority, [
        {
          path: 'fixture/workflow.yml',
          content: '    - uses: actions/checkout@v7 # v7.0.1',
        },
      ]),
    ).toContain(
      'fixture/workflow.yml: action actions/checkout@v7 is not pinned to a full commit SHA',
    )
  })

  it('rejects an unregistered external Docker base even when it is digest-pinned', () => {
    const authority = loadTechnologyStackAuthority(ROOT)
    const policy = loadContainerImagePolicy(ROOT)
    const digest = 'a'.repeat(64)

    expect(
      validateDockerBaseAuthority(authority, policy, [
        { path: 'Dockerfile', content: `FROM ubuntu:24.04@sha256:${digest} AS base` },
        ...policy.images
          .filter(({ dockerfile }) => dockerfile !== 'Dockerfile')
          .map(({ dockerfile }) => ({
            path: dockerfile,
            content: readFileSync(resolve(ROOT, dockerfile), 'utf8'),
          })),
      ]),
    ).toContain(
      `Dockerfile: external base ubuntu:24.04@sha256:${digest} is absent from the technology-stack authority`,
    )
  })

  it('rejects executable and affirmative shared guidance for schema push', () => {
    expect(
      validateDatabaseGuidance(
        [
          {
            path: 'package.json#scripts.deploy',
            content: 'drizzle-kit push',
          },
        ],
        [
          {
            path: 'MIGRATION.md',
            content: 'For a shared beta database, run `pnpm db:push`.',
          },
        ],
      ),
    ).toEqual([
      'package.json#scripts.deploy: executable schema push is forbidden',
      'MIGRATION.md:1: schema-push guidance is not an explicit prohibition',
    ])
  })

  it('rejects drift in Redis error handling and PostgreSQL non-replay safety', () => {
    const authority = loadTechnologyStackAuthority(ROOT)
    const sources = loadRuntimeContractSources(ROOT)

    expect(
      validateRuntimeContractSources(authority, {
        ...sources,
        queue: sources.queue.replace("queue.on('error'", "queue.on('closed'"),
        databasePool: sources.databasePool.replace(
          'wrapPoolConnectWithRetry(pool)',
          'void pool',
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        'BullMQ Queue instances must own a structured error handler',
        'PostgreSQL resilience must wrap acquisition only',
      ]),
    )
  })
})
