// Operator command harness wiring (BQC-7.5) — the module every scripts/ops/*
// command imports. Boots the minimal policy runtime against the ambient env
// (DATABASE_URL required; no dotenv — export env like the other ops scripts):
//
//   - the process-static capability configuration, with tenant grants and
//     consent read live by the ExecutionPolicy;
//   - the ExecutionPolicy, which returns every evaluated allow or typed deny;
//   - the named-operator allowlist from OPS_OPERATOR_IDENTITIES.
//
// The invocation contract (parse/validate/evaluate/run) lives in
// src/shared/ops/operator-command.ts with its unit tests — scripts/ sits
// outside tsconfig/eslint, so this file is wiring only.
//
// Commands receive one refusing Application Container on `ctx.container`.
// The harness claims it only after installing the policy runtime, so every
// command shares one graph and cannot cold-boot the web singleton mid-run.
//
// A command that needs only the database and the queue Redis (queue, refresh,
// the reports) runs through `runDatabaseOperatorCommand`: it boots the same
// policy runtime on the narrower settings and builds no container, so it needs
// neither the sign-in nor the mail settings.
//
// That container refuses every Google provider call. The three commands whose
// work is such a call only report: the invocation contract refuses `--apply`
// on them as a usage error and says what does the work instead
// (src/shared/ops/google-provider-commands.ts). The container's own refusals
// stay as the backstop for a command that reaches a provider path anyway.

import { getDatabaseOperatorEnv, getEnv } from '../../src/shared/config/env'
import { assertRestoreCommandEnvironment } from '../../src/shared/config/restore-mode'
import type { Container } from '../../src/composition'
import type { Env } from '../../src/shared/config/env'
import type { PolicyStoreHandle } from '../../src/contexts/identity/infrastructure/policy-store-init'
import {
  runOperatorCommand as runCore,
  parseOperatorArgs,
  validateOperatorArgs,
  type OperatorArgs,
  type OperatorCommandResult,
  type OperatorContext,
  type OperatorIO,
  type OperatorCommandSpec,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'

type PolicyBoot = Readonly<{
  runtime: OperatorRuntime
  handle: PolicyStoreHandle
  /** Release the process policy binding. */
  cleanup: () => void
}>

type OperatorBoot = PolicyBoot & Readonly<{ container: Container }>

// Loaded here, not at the top: `--help` and a refused argument list never
// reach this, so they open no settings, database or queue.
async function bootPolicyRuntime(env: () => Env): Promise<PolicyBoot> {
  // Read first: the settings are cached on first read, and the pool built next
  // reads them through `getEnv`, which would otherwise demand every setting.
  const settings = env()
  const [
    { getDb },
    { buildCapabilityPolicyHandle },
    { getLogger },
    { bindProcessPolicies, releaseProcessPolicies },
  ] = await Promise.all([
    import('../../src/shared/db'),
    import('../../src/contexts/identity/infrastructure/policy-store-init'),
    import('../../src/shared/observability/logger'),
    import('../../src/shared/auth/process-policy-binding'),
  ])
  const handle = buildCapabilityPolicyHandle({
    db: getDb(),
    env: settings,
    clock: () => new Date(),
    logger: getLogger(process.stderr),
  })
  // This is the ops process's one static policy installation. Tenant grants
  // and consent remain live through the execution policy's repositories.
  bindProcessPolicies(handle)
  return {
    runtime: { decide: (request) => handle.executionPolicy.decide(request) },
    handle,
    cleanup: () => {
      releaseProcessPolicies(handle)
    },
  }
}

/** Boot the policy runtime, then the refusing operator Application Container. */
async function bootOperatorRuntime(): Promise<OperatorBoot> {
  const policy = await bootPolicyRuntime(getEnv)
  const [
    { claimProcessContainer, releaseProcessContainer },
    { createOperatorContainer },
  ] = await Promise.all([
    import('../../src/composition'),
    import('../../src/composition/operator-container'),
  ])
  claimProcessContainer('operator')
  try {
    const container = createOperatorContainer()
    // Preserve the shared boot contract; static policy observation is immediate.
    await policy.handle.refresh()
    return { ...policy, container }
  } catch (error) {
    releaseProcessContainer()
    policy.cleanup()
    throw error
  }
}

/** Existing action contract enriched with the harness-owned operator surface. */
export type OpsAction = (
  ctx: OperatorContext & Readonly<{ container: Container }>,
  args: OperatorArgs,
  io: OperatorIO,
) => Promise<number | void>

/**
 * What is decided before anything opens: the restore environment check, then
 * argument errors for a restore command, then `--help`. The boot that follows
 * connects the database and builds queue handles, and a BullMQ queue writes its
 * metadata to the Redis it is pointed at as soon as it connects.
 */
function refuseBeforeBoot(
  spec: OperatorCommandSpec,
  argv: ReadonlyArray<string>,
  io?: OperatorIO,
): OperatorCommandResult | undefined {
  if (spec.isolatedRestore) {
    assertRestoreCommandEnvironment(getEnv())
    if (!argv.includes('--help')) {
      const parsed = parseOperatorArgs(argv, spec)
      const invalid = parsed.ok ? validateOperatorArgs(spec, parsed.args) : parsed.error
      if (invalid) {
        const writeError = io?.err ?? console.error
        writeError(`${invalid}\nusage: ${spec.usage}`)
        return { exitCode: 1 }
      }
    }
  }
  if (argv.includes('--help')) {
    const writeHelp = io?.out ?? ((line: string) => console.log(line))
    writeHelp(`usage: ${spec.usage}`)
    return { exitCode: 0 }
  }
  return undefined
}

/**
 * Run an operator command through the real policy runtime. The action receives
 * the same refusing container that this harness shuts down, so it cannot
 * cold-boot a second container.
 *
 * Cleanup releases the policy binding and process claim, then closes the
 * operator container, queues, and shared database pool.
 */
export async function runOperatorCommand(
  spec: OperatorCommandSpec,
  action: OpsAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
  io?: OperatorIO,
): Promise<OperatorCommandResult> {
  const refused = refuseBeforeBoot(spec, argv, io)
  if (refused) return refused
  const boot = await bootOperatorRuntime()
  try {
    return await runCore(
      spec,
      (ctx, args, actionIO) =>
        action({ ...ctx, container: boot.container }, args, actionIO),
      boot.runtime,
      argv,
      io,
    )
  } finally {
    boot.cleanup()
    const [{ releaseProcessContainer }, { closeJobQueueConnections }, { closePool }] =
      await Promise.all([
        import('../../src/composition'),
        import('../../src/shared/jobs/queue'),
        import('../../src/shared/db/pool'),
      ])
    const queues = new Set([
      boot.container.jobQueue,
      boot.container.backgroundQueue,
      boot.container.opsQueues.background,
      boot.container.opsQueues.domainEvents,
      boot.container.opsQueues.quarantine,
    ])
    try {
      await boot.container.shutdown.run()
      await Promise.all(Array.from(queues, (queue) => queue?.close()))
    } finally {
      releaseProcessContainer()
      await closeJobQueueConnections()
      await closePool()
    }
  }
}

/** The action of a command that needs only the database and the queue Redis. */
export type DatabaseOpsAction = (
  ctx: OperatorContext,
  args: OperatorArgs,
  io: OperatorIO,
) => Promise<number | void>

/**
 * Run an operator command through the real policy runtime on the database and
 * queue settings alone. No container is built, so nothing else is read or
 * connected; the command opens whatever queue it needs and closes it itself.
 */
export async function runDatabaseOperatorCommand(
  spec: OperatorCommandSpec,
  action: DatabaseOpsAction,
  argv: ReadonlyArray<string> = process.argv.slice(2),
  io?: OperatorIO,
): Promise<OperatorCommandResult> {
  const refused = refuseBeforeBoot(spec, argv, io)
  if (refused) return refused
  const boot = await bootPolicyRuntime(getDatabaseOperatorEnv)
  try {
    return await runCore(spec, action, boot.runtime, argv, io)
  } finally {
    boot.cleanup()
    const [{ closeJobQueueConnections }, { closePool }] = await Promise.all([
      import('../../src/shared/jobs/queue'),
      import('../../src/shared/db/pool'),
    ])
    try {
      await closeJobQueueConnections()
    } finally {
      await closePool()
    }
  }
}
