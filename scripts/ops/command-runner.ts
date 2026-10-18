// Running the CLIs the ops commands drive (git, gh, railway) and reading the
// JSON they print. Commands take a CommandRunner so tests can answer for them.

import { spawnSync } from 'node:child_process'
import type { ZodType } from 'zod/v4'

export type CommandResult = Readonly<{
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}>
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
) => CommandResult

export const defaultCommandRunner: CommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

export function checkedOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
): string {
  const result = runner(command, args, options)
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || result.stdout.trim()
    const status = result.status === null ? '' : ` (${String(result.status)})`
    throw new Error(
      `${command} ${args.join(' ')} failed${status}: ${detail || 'no diagnostic output'}`,
    )
  }
  return result.stdout
}

export function parseJson<T>(content: string, schema: ZodType<T>, label: string): T {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(({ path, message }) => `${path.join('.') || '<root>'}: ${message}`)
      .join('; ')
    throw new Error(`${label} is invalid: ${issues}`)
  }
  return parsed.data
}
