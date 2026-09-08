// `pnpm local:up`, second half: the web dev server (HMR) and the worker on the
// host, against the Compose services `scripts/e2e/stack-services.sh` started.
// The environment is the committed `e2e/stack.env` (already exported by the
// package script), then the gitignored `local.env` overlay if it exists, plus
// the three host-only adjustments the containers get from Compose: loopback
// resolution of the service names, trust for the sandbox's run-scoped CA, and
// the worker's writer keys. Nothing here selects an `E2E` posture - this stack
// behaves like the deployed cell, against the sandbox or against real Google
// (`REPKEY_LOCAL_GOOGLE=real`; see ./google-provider-mode.ts).
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyEnvOverlay, googleProviderMode } from './google-provider-mode'

const root = process.cwd()

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set - run this through \`pnpm local:up\``)
  return value
}

const overlaid = applyEnvOverlay(process.env, resolve(root, 'local.env'))
const google = googleProviderMode(process.env)

const hostEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  NODE_EXTRA_CA_CERTS: resolve(root, 'e2e/.certs/ca.crt'),
  NODE_OPTIONS: `--import ${pathToFileURL(resolve(root, 'scripts/local/loopback-hosts.mjs')).href}`,
}

const processes: Array<{ name: string; child: ChildProcess }> = [
  {
    name: 'web',
    child: spawn(
      'pnpm',
      ['exec', 'vite', 'dev', '--host', '127.0.0.1', '--port', '3000'],
      {
        cwd: root,
        env: hostEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  },
  {
    name: 'worker',
    child: spawn('pnpm', ['exec', 'tsx', 'src/worker/index.ts'], {
      cwd: root,
      env: {
        ...hostEnv,
        REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: required(
          'WORKER_REVIEW_PROVIDER_SUBJECT_HMAC_KEYS',
        ),
        AI_SUBJECT_HMAC_KEYS: required('WORKER_AI_SUBJECT_HMAC_KEYS'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  },
]

function forward(
  name: string,
  stream: NodeJS.ReadableStream | null,
  out: NodeJS.WriteStream,
) {
  if (!stream) return
  let rest = ''
  stream.on('data', (chunk: Buffer) => {
    rest += chunk.toString('utf8')
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) out.write(`[${name}] ${line}\n`)
  })
  stream.on('end', () => {
    if (rest) out.write(`[${name}] ${rest}\n`)
  })
}

let shuttingDown = false
function shutdown(signal: NodeJS.Signals, code: number) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of processes) child.kill(signal)
  setTimeout(() => process.exit(code), 3_000).unref()
}

for (const { name, child } of processes) {
  forward(name, child.stdout, process.stdout)
  forward(name, child.stderr, process.stderr)
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    process.stderr.write(`[${name}] exited (${signal ?? code}); stopping the stack\n`)
    shutdown('SIGTERM', code ?? 1)
  })
}

process.on('SIGINT', () => shutdown('SIGINT', 0))
process.on('SIGTERM', () => shutdown('SIGTERM', 0))

process.stdout.write(
  [
    '[local] web http://127.0.0.1:3000 (the BETTER_AUTH_URL origin) - manager test@example.com',
    '        (password: E2E_TEST_PASSWORD in e2e/stack.env), staff staff@example.com / password123',
    ...(overlaid.length > 0
      ? [`[local] local.env overlay applied: ${overlaid.join(', ')}`]
      : []),
    `[local] ${google.summary}`,
    '[local] Ctrl-C stops both processes; `pnpm local:down` removes the services',
  ].join('\n') + '\n',
)
