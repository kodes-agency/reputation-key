import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readMigrationJournal } from '../../src/shared/db/migration-journal-order'
import * as imageMaps from './ci-image-digest-map'
import { digestMapValue, REVISION } from './ci-image-digest-map.test-fixtures'
import {
  assertContractionPreflight,
  readPendingContractRequirements,
  type RunningReaderRevision,
} from './migration-preflight'
import {
  applyClosedBetaImageDeployment,
  buildClosedBetaImageDeploymentPlan,
  CLOSED_BETA_IMAGE_SERVICES,
  railwayTargetArgs,
  type ClosedBetaImageDeployment,
  type RailwayServiceObservation,
} from './deploy-ci-images'
import type { CommandRunner } from './command-runner'

const removal = 'a'.repeat(40)
const old = 'b'.repeat(40)
const revision = 'c'.repeat(40)
const contractTime = 1_000
const requirements = [{ tag: 'contract_storage', readerRemoval: removal }]
const running: RunningReaderRevision[] = ['web', 'worker'].map((serviceName) => ({
  serviceName,
  revision: removal,
  healthy: true,
  runningDigest: 'sha256:current',
  revisionDigest: 'sha256:current',
}))
const ancestor = (from: string, to: string) => from === removal && to !== old

function recoveryServiceSnapshot(service: RailwayServiceObservation, deployed: boolean) {
  return {
    ...service,
    status: deployed ? 'SUCCESS' : service.status,
    latestDeployment: {
      id: deployed ? `${service.deploymentId}-next` : service.deploymentId,
    },
    replicas: {
      configured: 1,
      running: deployed ? 1 : service.runningReplicas,
      crashed: deployed ? 0 : service.crashedReplicas,
    },
  }
}

describe('contraction preflight', () => {
  it.each(['0083_review_analysis_v3_switch_on', '0053_clear_legacy_asset_urls'])(
    'refuses copied legacy SQL before any deployment mutation: %s',
    async (tag) => {
      const original = readMigrationJournal().find((entry) => entry.tag === tag)!
      const sql = readFileSync(
        new URL(`../../drizzle/${tag}.sql`, import.meta.url),
        'utf8',
      )
      for (const identity of [
        { tag: 'copied_legacy', when: original.when },
        { tag, when: original.when + 1 },
        { tag: 'copied_legacy', when: original.when + 1 },
      ]) {
        const mutations: string[] = []
        const runner: CommandRunner = (command, args) => {
          if (command !== 'git') mutations.push(args.join(' '))
          return {
            status: 0,
            stderr: '',
            stdout: args[1]?.endsWith('_journal.json')
              ? JSON.stringify({ entries: [identity] })
              : sql,
          }
        }
        const plan = CLOSED_BETA_IMAGE_SERVICES.map((service) => ({
          ...service,
          sourceRevision: revision,
        })) as ClosedBetaImageDeployment[]

        await expect(applyClosedBetaImageDeployment({ plan, runner })).rejects.toThrow(
          'reader-removal commit',
        )
        expect(mutations).toEqual([])
      }
    },
  )

  it('exempts legacy SQL only under its original deployment journal identity', () => {
    const original = readMigrationJournal().find(
      ({ tag }) => tag === '0083_review_analysis_v3_switch_on',
    )!
    const sql = readFileSync(
      new URL(`../../drizzle/${original.tag}.sql`, import.meta.url),
      'utf8',
    )
    const runner: CommandRunner = (command, args) => {
      expect(command).toBe('git')
      return {
        status: 0,
        stderr: '',
        stdout: args[1]?.endsWith('_journal.json')
          ? JSON.stringify({ entries: [original] })
          : sql,
      }
    }

    expect(readPendingContractRequirements(revision, runner, [])).toEqual([])
  })

  it.each(['web', 'worker'])(
    'deploys a recovery when %s is unhealthy after a contraction applied',
    async (failedService) => {
      const map = imageMaps.parseCiImageDigestMap(
        JSON.stringify(digestMapValue()),
        REVISION,
      )
      const lookup = vi.spyOn(imageMaps, 'downloadCiImageDigestMap').mockReturnValue(map)
      const health = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))
      const inventory = CLOSED_BETA_IMAGE_SERVICES.map((service, index) => ({
        id: service.serviceId,
        name: service.serviceName,
        source: { repo: null, image: null },
        status: service.serviceName === failedService ? 'CRASHED' : 'SUCCESS',
        deploymentStopped: false,
        deploymentId: `deployment-${index}`,
        configuredReplicas: 1,
        runningReplicas: service.serviceName === failedService ? 0 : 1,
        crashedReplicas: service.serviceName === failedService ? 1 : 0,
      }))
      const plan = buildClosedBetaImageDeploymentPlan(map, inventory)
      const deployed = new Set<string>()
      const runner: CommandRunner = (command, args) => {
        const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' })
        if (command === 'git') {
          if (args[0] === 'show')
            return ok(
              args[1]?.endsWith('_journal.json')
                ? JSON.stringify({
                    entries: [{ tag: 'contract_storage', when: contractTime }],
                  })
                : `-- migrate:contract ${removal}\nALTER TABLE records DROP COLUMN retired;`,
            )
          if (args[0] === 'merge-base') return ok('')
        }
        if (args[0] === 'ssh') {
          expect(args).toEqual(expect.arrayContaining(railwayTargetArgs('Postgres')))
          return ok(JSON.stringify([contractTime]))
        }
        if (args[0] === 'service' && args[1] === 'list')
          return ok(
            JSON.stringify(
              inventory.map((service) =>
                recoveryServiceSnapshot(service, deployed.has(service.id)),
              ),
            ),
          )
        const selected = plan.find((service) => args.includes(service.serviceId))!
        if (args[0] === 'variable' && args[1] === 'list')
          return ok(`RELEASE_SHA=${removal}\n`)
        if (args[0] === 'variable' && args[1] === 'set') return ok('{}')
        if (args[0] === 'service' && args[1] === 'source') {
          deployed.add(selected.serviceId)
          return ok('{}')
        }
        if (args[0] === 'deployment' && args[1] === 'list') {
          const current = recoveryServiceSnapshot(
            inventory.find((service) => service.id === selected.serviceId)!,
            deployed.has(selected.serviceId),
          )
          return ok(
            JSON.stringify([
              {
                id: current.latestDeployment.id,
                status: current.status,
                meta: { imageDigest: selected.digest },
              },
            ]),
          )
        }
        throw new Error('unexpected command')
      }
      try {
        await expect(
          applyClosedBetaImageDeployment({ plan, runner, out: () => {} }),
        ).resolves.toEqual(
          plan.map((service) => ({
            serviceName: service.serviceName,
            deploymentId: `${service.beforeDeploymentId}-next`,
          })),
        )
        expect([...deployed]).toEqual(plan.map((service) => service.serviceId))
      } finally {
        lookup.mockRestore()
        health.mockRestore()
      }
    },
  )
  it.each(['web', 'worker'])(
    'blocks the apply path before mutations when running %s still has readers',
    async (olderService) => {
      const map = imageMaps.parseCiImageDigestMap(
        JSON.stringify(digestMapValue()),
        REVISION,
      )
      const lookup = vi.spyOn(imageMaps, 'downloadCiImageDigestMap').mockReturnValue(map)
      const inventory = CLOSED_BETA_IMAGE_SERVICES.map((service, index) => ({
        id: service.serviceId,
        name: service.serviceName,
        source: { repo: null, image: null },
        status: 'SUCCESS',
        deploymentStopped: false,
        deploymentId: `deployment-${index}`,
        configuredReplicas: 1,
        runningReplicas: 1,
        crashedReplicas: 0,
      }))
      const mutations: string[] = []
      const runner: CommandRunner = (command, args) => {
        const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' })
        if (command === 'git') {
          if (args[0] === 'show')
            return ok(
              args[1]?.endsWith('_journal.json')
                ? JSON.stringify({
                    entries: [{ tag: 'contract_storage', when: contractTime }],
                  })
                : `-- migrate:contract ${removal}\nALTER TABLE records DROP COLUMN retired;`,
            )
          if (args[0] === 'merge-base')
            return { ...ok(''), status: args[3] === old ? 1 : 0 }
        }
        if (args[0] === 'ssh') return ok(JSON.stringify([contractTime + 1]))
        if (args[0] === 'service' && args[1] === 'list')
          return ok(
            JSON.stringify(
              inventory.map((service) => ({
                ...service,
                latestDeployment: { id: service.deploymentId },
                replicas: { configured: 1, running: 1, crashed: 0 },
              })),
            ),
          )
        const selected = CLOSED_BETA_IMAGE_SERVICES.find((service) =>
          args.includes(service.serviceId),
        )!
        if (args[0] === 'variable' && args[1] === 'list')
          return ok(
            `RELEASE_SHA=${selected.serviceName === olderService ? old : removal}\n`,
          )
        if (args[0] === 'deployment' && args[1] === 'list')
          return ok(
            JSON.stringify([
              {
                id: inventory.find((service) => service.id === selected.serviceId)!
                  .deploymentId,
                status: 'SUCCESS',
                meta: { imageDigest: map.images[selected.imageName].digest },
              },
            ]),
          )
        mutations.push(`${command} ${args.join(' ')}`)
        throw new Error('unexpected mutation')
      }
      const plan = buildClosedBetaImageDeploymentPlan(map, inventory).map((service) => ({
        ...service,
        sourceRevision: revision,
      }))
      try {
        await expect(
          applyClosedBetaImageDeployment({ plan, runner, out: () => {} }),
        ).rejects.toThrow(`${olderService} must be running`)
        expect(mutations).toEqual([])
      } finally {
        lookup.mockRestore()
      }
    },
  )
  it.each(['web', 'worker'])('refuses when %s still runs readers', (serviceName) => {
    expect(() =>
      assertContractionPreflight(
        requirements,
        running.map((service) =>
          service.serviceName === serviceName ? { ...service, revision: old } : service,
        ),
        ancestor,
      ),
    ).toThrow(`${serviceName} must be running`)
  })

  it.each([
    { healthy: false },
    { revision: null },
    { runningDigest: null },
    { runningDigest: 'sha256:old' },
    { revisionDigest: null },
  ])('refuses unproved running revisions: %j', (missing) => {
    expect(() =>
      assertContractionPreflight(
        requirements,
        running.map((service) =>
          service.serviceName === 'worker' ? { ...service, ...missing } : service,
        ),
        ancestor,
      ),
    ).toThrow('worker must be running')
  })

  it('accepts both verified running descendants of the removal release', () => {
    expect(() =>
      assertContractionPreflight(requirements, running, ancestor),
    ).not.toThrow()
  })

  it('keeps an unapplied contraction pending even when a later contraction applied', () => {
    const runner: CommandRunner = (_command, args) => ({
      status: 0,
      stderr: '',
      stdout:
        args[0] === 'ssh'
          ? JSON.stringify([contractTime + 1])
          : args[1]?.endsWith('_journal.json')
            ? JSON.stringify({
                entries: [
                  { tag: 'contract_storage', when: contractTime },
                  { tag: 'contract_later', when: contractTime + 1 },
                ],
              })
            : `-- migrate:contract ${removal}\nALTER TABLE records DROP COLUMN retired;`,
    })
    expect(readPendingContractRequirements(revision, runner, [])).toEqual(requirements)
  })

  it.each([
    { status: 1, stdout: '', stderr: 'cannot read journal' },
    { status: 0, stdout: 'null', stderr: '' },
    { status: 0, stdout: '[null]', stderr: '' },
  ])(
    'refuses before deployment mutations when applied state is unproved: %j',
    async (unproved) => {
      const mutations: string[] = []
      const runner: CommandRunner = (command, args) => {
        if (args[0] === 'ssh') return unproved
        if (command !== 'git') mutations.push(args.join(' '))
        return {
          status: 0,
          stderr: '',
          stdout: args[1]?.endsWith('_journal.json')
            ? JSON.stringify({
                entries: [{ tag: 'contract_storage', when: contractTime }],
              })
            : `-- migrate:contract ${removal}\nALTER TABLE records DROP COLUMN retired;`,
        }
      }
      const plan = CLOSED_BETA_IMAGE_SERVICES.map((service) => ({
        ...service,
        sourceRevision: revision,
      })) as ClosedBetaImageDeployment[]
      await expect(applyClosedBetaImageDeployment({ plan, runner })).rejects.toThrow(
        unproved.status ? 'cannot read journal' : 'Applied migration timestamps',
      )
      expect(mutations).toEqual([])
    },
  )

  it.each([
    'DROP SCHEMA archive CASCADE;',
    'DROP MATERIALIZED VIEW public.record_totals;',
    'ALTER TABLE public.records SET SCHEMA archive;',
    'ALTER TABLE records DROP COLUMN retired;',
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER COLUMN value DROP DEFAULT;',
    'UNKNOWN MIGRATION STATEMENT;',
  ])('reads contraction declarations from the selected revision: %s', (sql) => {
    const calls: string[][] = []
    const runner: CommandRunner = (_command, args) => {
      calls.push([...args])
      return {
        status: 0,
        stderr: '',
        stdout:
          args[0] === 'ssh'
            ? '[]'
            : args[1]?.endsWith('_journal.json')
              ? JSON.stringify({
                  entries: [{ tag: 'contract_storage', when: contractTime }],
                })
              : `-- migrate:contract ${removal}\n${sql}`,
      }
    }
    expect(readPendingContractRequirements(revision, runner, [])).toEqual(requirements)
    expect(calls.slice(0, 2)).toEqual([
      ['show', `${revision}:drizzle/meta/_journal.json`],
      ['show', `${revision}:drizzle/contract_storage.sql`],
    ])
  })

  it.each([
    'DROP SCHEMA archive CASCADE;',
    'DROP MATERIALIZED VIEW public.record_totals;',
    'ALTER TABLE public.records SET SCHEMA archive;',
    'ALTER TABLE records DROP COLUMN retired;',
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER COLUMN value DROP DEFAULT;',
    'UNKNOWN MIGRATION STATEMENT;',
  ])('refuses undeclared contraction before any deployment mutation: %s', async (sql) => {
    const mutations: string[] = []
    const runner: CommandRunner = (command, args) => {
      if (command !== 'git') mutations.push(args.join(' '))
      return {
        status: 0,
        stderr: '',
        stdout: args[1]?.endsWith('_journal.json')
          ? JSON.stringify({ entries: [{ tag: 'contract_storage' }] })
          : sql,
      }
    }
    const plan = CLOSED_BETA_IMAGE_SERVICES.map((service) => ({
      ...service,
      sourceRevision: revision,
    })) as ClosedBetaImageDeployment[]
    await expect(applyClosedBetaImageDeployment({ plan, runner })).rejects.toThrow(
      'Contract migration requires',
    )
    expect(mutations).toEqual([])
  })
})
