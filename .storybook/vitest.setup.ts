import { afterEach, beforeEach, vi } from 'vitest'

// `@storybook/react` reads `globalThis.FRAMEWORK_OPTIONS` once at module load
// to decide whether to mount stories under <StrictMode>. The Vite builder
// injects it by rewriting iframe.html, which this Vitest browser project never
// loads, so `framework.options.strictMode` in main.ts is silently ignored here.
// Define it before any story module is imported: the app mounts under
// StrictMode (src/client.tsx) and the component gate must too.
Object.assign(globalThis, { FRAMEWORK_OPTIONS: { strictMode: true } })

type ConsoleErrorAllowlistEntry = Readonly<{
  id: string
  pattern: RegExp | string
  owner: string
  reason: string
  /** ISO date (YYYY-MM-DD); the exception is valid through that day in UTC. */
  expires: string
}>

const CONSOLE_ERROR_ALLOWLIST: readonly ConsoleErrorAllowlistEntry[] = []
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

let recordedErrors: unknown[][] = []
let restoreConsoleError: (() => void) | undefined

function assertAllowlistEntry(entry: ConsoleErrorAllowlistEntry): void {
  if (!entry.id.trim() || !entry.owner.trim() || !entry.reason.trim()) {
    throw new Error(
      'Storybook console-error allowlist entries require id, owner and reason',
    )
  }
  if (!ISO_DATE.test(entry.expires)) {
    throw new Error(
      `Storybook console-error allowlist entry '${entry.id}' has invalid expiry`,
    )
  }
  const expiresAt = Date.parse(`${entry.expires}T23:59:59.999Z`)
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    throw new Error(`Storybook console-error allowlist entry '${entry.id}' has expired`)
  }
}

function renderArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

beforeEach(() => {
  for (const entry of CONSOLE_ERROR_ALLOWLIST) assertAllowlistEntry(entry)
  recordedErrors = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    recordedErrors.push(args)
  })
  restoreConsoleError = () => spy.mockRestore()
})

afterEach(() => {
  const unexpected = recordedErrors
    .map((args) => args.map(renderArgument).join(' '))
    .filter((message) => {
      const allowlisted = CONSOLE_ERROR_ALLOWLIST.some(({ pattern }) => {
        if (typeof pattern === 'string') return message.includes(pattern)
        pattern.lastIndex = 0
        return pattern.test(message)
      })
      return !allowlisted
    })

  restoreConsoleError?.()
  restoreConsoleError = undefined

  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected console.error output:\n${unexpected
        .map((message, index) => `${index + 1}. ${message}`)
        .join('\n')}`,
    )
  }
})
