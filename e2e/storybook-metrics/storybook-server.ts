// Which Storybook the metrics gate measures, and the proof that it is THIS
// checkout's.
//
// ── Why a proof is needed ───────────────────────────────────────────────────
//
// `playwright.storybook.config.ts` reuses a Storybook that is already running,
// because a developer usually has one up and its cold start is minutes. A port
// is not an identity, though: this repository has dozens of git worktrees
// (`git worktree list`), and each runs `pnpm storybook` on the same :6006.
// Review demonstrated the cost: a copy of the tree with the reply-due detail
// shrunk to 28 px went red against its own Storybook, and printed `✓ 390 px ›
// inbox-case-toolbar--due-soon-390` against the main checkout's — green over
// code that was not the code under test. `/index.json` cannot tell them apart
// either: its `importPath`s are relative, so every checkout's index is the same.
//
// ── The proof ───────────────────────────────────────────────────────────────
//
// Storybook's Vite dev server serves the files under its root (measured:
// `GET /package.json` answers 200 on :6006). Before any story loads, the global
// setup below writes a file with a random name and random content into THIS
// checkout, asks the server for it, and deletes it. Only a server whose root is
// this checkout can answer with those bytes; any other answers 404, or with
// Storybook's HTML, and the run stops before a single story is measured, naming
// the fix. It proves the server's ROOT, not merely one file's content, so two
// worktrees on the same commit are still told apart. The file sits under
// `test-results/`, which is git-ignored (`.gitignore:7`) and outside Vite's
// module graph, so writing it reloads nothing.
//
// To run a worktree's gate while another checkout holds :6006, give it its own
// port: `STORYBOOK_METRICS_PORT=6016 pnpm test:storybook:metrics` starts (or
// reuses) that worktree's Storybook there.

import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { FullConfig } from '@playwright/test'

const DEFAULT_PORT = 6006

function portFromEnvironment(): number {
  const raw = process.env.STORYBOOK_METRICS_PORT
  if (raw === undefined || raw === '') return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`STORYBOOK_METRICS_PORT must be a TCP port, got "${raw}"`)
  }
  return port
}

export const STORYBOOK_PORT = portFromEnvironment()
export const STORYBOOK_URL = `http://localhost:${STORYBOOK_PORT}`

/** Where the identity file is written, relative to the checkout (the dev server's root). */
const IDENTITY_DIRECTORY = join('test-results', 'storybook-metrics')

/** Bounded, because an unreachable server would otherwise hang the setup. */
const IDENTITY_REQUEST_TIMEOUT_MS = 30_000

export default async function verifyStorybookIsThisCheckout(
  config: FullConfig,
): Promise<void> {
  const checkout = dirname(config.configFile ?? join(process.cwd(), 'package.json'))
  const token = randomBytes(16).toString('hex')
  const file = join(checkout, IDENTITY_DIRECTORY, `server-identity-${token}.txt`)
  const urlPath = relative(checkout, file).split(sep).join('/')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, token, 'utf8')
  try {
    const response = await fetch(`${STORYBOOK_URL}/${urlPath}`, {
      signal: AbortSignal.timeout(IDENTITY_REQUEST_TIMEOUT_MS),
    })
    const body = (await response.text()).trim()
    if (response.ok && body === token) return
    throw new Error(
      [
        `The Storybook on ${STORYBOOK_URL} is not serving this checkout (${checkout}).`,
        `It answered ${response.status} to /${urlPath}, a file only this checkout has.`,
        'Every measurement would be of another tree, so none was taken. Either stop the',
        `other Storybook, or give this checkout its own: STORYBOOK_METRICS_PORT=<free port> pnpm test:storybook:metrics`,
      ].join('\n'),
    )
  } finally {
    await rm(file, { force: true })
  }
}
