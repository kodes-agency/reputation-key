import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workflowJob, workflowSteps } from './ci-workflow-text'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8',
)
const step = workflowSteps(workflowJob(workflow, 'populated-upgrade')).find(
  ({ name }) => name === 'Load candidate and pin previous image',
)!
const script = step.content
  .split('        run: |\n')[1]!
  .split('\n')
  .filter((line) => line.startsWith('          '))
  .map((line) => line.slice(10))
  .join('\n')
const published = 'a'.repeat(40)
const mainBase = 'b'.repeat(40)
const branchParent = 'c'.repeat(40)
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function selectBaseline(
  previous = '',
  options: { missing?: boolean; mismatch?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'upgrade-baseline-'))
  directories.push(directory)
  const executable = (name: string, body: string) =>
    writeFileSync(join(directory, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, {
      mode: 0o755,
    })
  executable('zstd', 'exit 0')
  executable(
    'git',
    `
case "$1" in
  rev-parse) echo '${branchParent}' ;;
  merge-base) echo '${mainBase}' ;;
  rev-list) echo "\${*: -1}"; if [[ "\${*: -1}" != '${published}' ]]; then echo '${published}'; fi ;;
  *) exit 1 ;;
esac`,
  )
  executable(
    'docker',
    `
case "$1" in
  load) exit 0 ;;
  pull|manifest)
    echo "\${*: -1}" >> probes
    [[ "\${MISSING:-}" != 1 && "\${*: -1}" == 'ghcr.io/kodes-agency/repkey-web:${published}' ]] ;;
  image)
    if [[ "$*" == *'RepoDigests'* ]]; then
      echo 'ghcr.io/kodes-agency/repkey-web@sha256:${'d'.repeat(64)}'
    elif [[ "\${MISMATCH:-}" == 1 ]]; then echo '${branchParent}'
    else echo '${published}'; fi ;;
  *) exit 1 ;;
esac`,
  )
  const envFile = join(directory, 'github-env')
  writeFileSync(envFile, '')
  const result = spawnSync('bash', ['-c', script], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      PREVIOUS_REVISION: previous,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_ENV: envFile,
      MISSING: options.missing ? '1' : '',
      MISMATCH: options.mismatch ? '1' : '',
    },
  })
  return {
    ...result,
    environment: readFileSync(envFile, 'utf8'),
    probes: readFileSync(join(directory, 'probes'), 'utf8').trim().split('\n'),
  }
}

describe('populated upgrade baseline', () => {
  it('dispatches a multi-commit branch against a published main ancestor', () => {
    const result = selectBaseline()
    expect(result.status, result.stderr).toBe(0)
    expect(result.environment).toContain(
      `POPULATED_UPGRADE_PREVIOUS_IMAGE=ghcr.io/kodes-agency/repkey-web@sha256:${'d'.repeat(64)}`,
    )
    expect(result.probes).toEqual(
      [mainBase, published, published].map(
        (revision) => `ghcr.io/kodes-agency/repkey-web:${revision}`,
      ),
    )
  })

  it('retains the event baseline when its image is published', () => {
    const result = selectBaseline(published)
    expect(result.status, result.stderr).toBe(0)
    expect(result.environment).toContain('POPULATED_UPGRADE_PREVIOUS_IMAGE=')
    expect(result.probes.every((reference) => reference.endsWith(published))).toBe(true)
  })

  it('resolves a published ancestor when the event has no previous revision', () => {
    const result = selectBaseline('0'.repeat(40))
    expect(result.status, result.stderr).toBe(0)
  })

  it.each([{ missing: true }, { mismatch: true }])(
    'refuses an unavailable or incorrectly labelled baseline: %j',
    (options) => {
      const result = selectBaseline('', options)
      expect(result.status).not.toBe(0)
      expect(result.environment).toBe('')
    },
  )
})
