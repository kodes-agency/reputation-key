import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseCiImageDigestMap,
  verifyDispatchedCiImageDigestMap,
} from '../ops/ci-image-digest-map'
import { fakeDispatchedRun, REVISION } from '../ops/ci-image-digest-map.test-fixtures'
import { workflowJob, workflowSteps } from './ci-workflow-text'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8',
)
const jobs = [...workflow.matchAll(/^ {2}([a-z][\w-]*):$/gmu)].map((match) => match[1]!)
const allSteps = jobs.flatMap((job) =>
  workflowSteps(workflowJob(workflow, job)).map((step) => ({ ...step, job })),
)
const mainRef = 'refs/heads/main'

function enabled(content: string, event: string, ref: string): boolean {
  const guard = /^ {8}if: (.*)$/mu.exec(content)?.[1]
  if (!guard) return true
  return guard
    .replace(/[()]/gu, '')
    .split('||')
    .some((clause) =>
      clause.split('&&').every((test) => {
        const match = /^\s*github\.(event_name|ref) == '([^']+)'\s*$/u.exec(test)
        if (!match) throw new Error(`unsupported publication guard: ${test}`)
        return (match[1] === 'event_name' ? event : ref) === match[2]
      }),
    )
}

const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function publication(
  options: {
    event?: string
    omit?: string
    conflict?: string
    badReadback?: boolean
    badStaged?: boolean
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'image-publication-'))
  directories.push(directory)
  const images = ['google-provider-redis', 'web', 'worker'].map((image, index) => ({
    image,
    repository: `ghcr.io/kodes-agency/repkey-${image}`,
    stagedReference: `ghcr.io/kodes-agency/repkey-${image}:ci-run-42050000001-1`,
    digest: `sha256:${String(index + 1).repeat(64)}`,
    sourceRevision: REVISION,
  }))
  // Execute the workflow's actual jq and promotion scripts; the registry is the
  // only fake. It records tag writes and serves the descriptors' digests.
  writeFileSync(join(directory, 'registry.json'), JSON.stringify(images))
  mkdirSync(join(directory, 'staged-image-digests'))
  for (const image of images.filter(({ image }) => image !== options.omit)) {
    writeFileSync(
      join(directory, 'staged-image-digests', `${image.image}.json`),
      JSON.stringify(image),
    )
  }
  writeFileSync(
    join(directory, 'docker'),
    `#!/usr/bin/env bash
set -eu
if [[ "$*" == *"imagetools create"* ]]; then
  echo "$*" >> writes
  touch "$(echo "$6" | tr '/:' '__')"
  exit 0
fi
reference="$4"
digest=$(jq -r --arg reference "$reference" '.[] | . as $image | select($reference | startswith($image.repository)) | .digest' registry.json)
if [[ "$reference" == *":ci-run-"* ]]; then
  if [[ "\${BAD_STAGED:-}" == 1 ]]; then echo 'sha256:bad'; else echo "$digest"; fi
  exit 0
fi
if [[ "$reference" == *"\${CONFLICT:-no-conflict}"* ]]; then echo 'sha256:conflict'; exit 0; fi
if [[ -f "$(echo "$reference" | tr '/:' '__')" ]]; then
  if [[ "\${BAD_READBACK:-}" == 1 ]]; then echo 'sha256:bad'; else echo "$digest"; fi
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  )
  const event = options.event ?? 'push'
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH ?? ''}`,
    GITHUB_SHA: REVISION,
    GITHUB_RUN_ID: '42050000001',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: 'kodes-agency/reputation-key',
    GITHUB_REF: mainRef,
    GITHUB_EVENT_NAME: event,
    CONFLICT: options.conflict ?? 'no-conflict',
    BAD_READBACK: options.badReadback ? '1' : '',
    BAD_STAGED: options.badStaged ? '1' : '',
  }
  const steps = workflowSteps(workflowJob(workflow, 'image'))
  const names = [
    'Validate complete staged image set',
    'Promote complete production image set',
    'Write image digest map',
  ]
  let status = 0
  let stderr = ''
  for (const name of names) {
    const step = steps.find((candidate) => candidate.name === name)
    if (!step) throw new Error(`missing image step ${name}`)
    if (!enabled(step.content, event, mainRef)) continue
    const script = step.content
      .split('        run: |\n')[1]
      ?.split('\n')
      .filter((line) => line.startsWith('          '))
      .map((line) => line.slice(10))
      .join('\n')
    if (!script) throw new Error(`missing script ${name}`)
    const result = spawnSync('bash', ['-c', script], {
      cwd: directory,
      env,
      encoding: 'utf8',
    })
    status = result.status ?? 1
    stderr += result.stderr
    if (status !== 0) break
  }
  const read = (file: string) => {
    try {
      return readFileSync(join(directory, file), 'utf8')
    } catch {
      return ''
    }
  }
  return { status, stderr, writes: read('writes'), map: read('ci-image-digest-map.json') }
}

describe('image publication ownership', () => {
  it.each([
    ['pull_request', mainRef, [], []],
    ['pull_request', 'refs/pull/1/merge', [], []],
    ['push', mainRef, ['image-scan', 'image'], ['image']],
    ['push', 'refs/heads/other', [], []],
    ['workflow_dispatch', 'refs/heads/other', ['image-scan'], ['image']],
    ['workflow_dispatch', mainRef, ['image-scan'], ['image']],
  ] as const)(
    'publishes only from the designated jobs on %s %s',
    (event, ref, publishers, writers) => {
      const active = allSteps.filter(({ content }) =>
        enabledForPublication(content, event, ref),
      )
      expect(
        active
          .filter(({ content }) => /docker push|imagetools create/u.test(content))
          .map(({ job }) => job),
      ).toEqual(publishers)
      expect(
        active
          .filter(({ content }) => content.includes('> ci-image-digest-map.json'))
          .map(({ job }) => job),
      ).toEqual(writers)
      expect(
        active
          .filter(({ content }) =>
            content.includes('name: ci-image-digest-map-${{ github.sha }}'),
          )
          .map(({ job }) => job),
      ).toEqual(writers)
    },
  )

  it('promotes all three scanned digests and emits a deployable replacement map', () => {
    const result = publication()
    expect(result.status, result.stderr).toBe(0)
    const map = parseCiImageDigestMap(result.map, REVISION)
    expect(map.source).toMatchObject({ job: 'image', runId: '42050000001', ref: mainRef })
    expect(result.writes.trim().split('\n')).toHaveLength(3)
    for (const image of Object.values(map.images))
      expect(result.writes).toContain(`${image.repository}@${image.digest}`)
  })

  it('keeps dispatch maps verifiable without writing commit tags', () => {
    const result = publication({ event: 'workflow_dispatch' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toBe('')
    const value = JSON.parse(result.map) as Record<string, unknown>
    const { runner } = fakeDispatchedRun({
      run: { id: 42050000001, head_branch: 'main' },
      digestMap: value,
    })
    expect(
      verifyDispatchedCiImageDigestMap(42050000001, runner).digestMap.source.event,
    ).toBe('workflow_dispatch')
    expect(() => parseCiImageDigestMap(result.map, REVISION)).toThrow(/source/u)
  })

  it.each(['google-provider-redis', 'web', 'worker'])(
    'refuses an incomplete set missing %s before any commit tag',
    (omit) => {
      const result = publication({ omit })
      expect(result.status).not.toBe(0)
      expect(result.writes).toBe('')
      expect(result.map).toBe('')
    },
  )

  it('preflights the whole set before creating a commit tag', () => {
    const result = publication({ conflict: 'repkey-worker' })
    expect(result.status).not.toBe(0)
    expect(result.writes).toBe('')
    expect(result.map).toBe('')
  })

  it('refuses a staged digest mismatch before creating commit tags', () => {
    const result = publication({ badStaged: true })
    expect(result.status).not.toBe(0)
    expect(result.writes).toBe('')
    expect(result.map).toBe('')
  })

  it('withholds the map when a final tag does not read back to its scanned digest', () => {
    const result = publication({ badReadback: true })
    expect(result.status).not.toBe(0)
    expect(result.writes.trim().split('\n')).toHaveLength(3)
    expect(result.map).toBe('')
  })
})

function enabledForPublication(content: string, event: string, ref: string): boolean {
  if (!/docker push|imagetools create|ci-image-digest-map/u.test(content)) return false
  return enabled(content, event, ref)
}
