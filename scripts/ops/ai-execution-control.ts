import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eq } from 'drizzle-orm'
import { getDb } from '../../src/shared/db'
import { aiExecutionControlHeads } from '../../src/shared/db/schema'
import type { MerchantAiCapability } from '../../src/shared/domain/merchant-ai-capability'
import type { AiControlScope } from '../../src/contexts/ai/application/ports/ai-control.port'
import { reputationReplyScopeEffects } from '../../src/composition/reply-scope-effects'
import { createAiControlAdapter } from '../../src/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runCommandEntrypoint } from './command-entrypoint'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:ai-control'
const USAGE =
  'pnpm ops ai-control <inspect|kill|drain|restore> global --operator <id> [--reason <text> --ticket <ref> --apply --yes ops:ai-control]; persisted controls: <inspect|restore> provider <profile> or <inspect|restore> capability <name> <profile> [release-sha-for-restore]'
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,99}$/
const RELEASE_SHA = /^[0-9a-f]{40}$/
const CAPABILITIES = [
  'review_analysis',
  'reply_drafting',
  'property_trends',
] as const satisfies readonly MerchantAiCapability[]

type Action = 'inspect' | 'kill' | 'drain' | 'restore'
type Parsed = Readonly<{
  action: Action
  scope: AiControlScope
  scopeKey: string
  providerDeploymentProfileVersion: string | null
  candidateReleaseSha: string | null
}>

function failUsage(): never {
  process.stderr.write(`Usage: ${USAGE}\n`)
  process.exit(1)
}

function parseProviderControl(action: Action, values: readonly string[]): Parsed | null {
  const [profile, ...extra] = values
  if (!profile || !PROFILE.test(profile) || extra.length !== 0) return null
  return {
    action,
    scope: {
      kind: 'provider_deployment_profile',
      providerDeploymentProfileVersion: profile,
    },
    scopeKey: `provider:${profile}`,
    providerDeploymentProfileVersion: profile,
    candidateReleaseSha: null,
  }
}

function parseCapabilityControl(
  action: Action,
  values: readonly string[],
): Parsed | null {
  const [value, profile, candidate, ...extra] = values
  if (
    !value ||
    !CAPABILITIES.some((capability) => capability === value) ||
    !profile ||
    !PROFILE.test(profile) ||
    extra.length !== 0
  ) {
    return null
  }
  const capability = value as MerchantAiCapability
  if (action === 'restore') {
    if (!candidate || !RELEASE_SHA.test(candidate)) return null
  } else if (candidate !== undefined) {
    return null
  }
  return {
    action,
    scope: { kind: 'capability', capability },
    scopeKey: `capability:${capability}`,
    providerDeploymentProfileVersion: profile,
    candidateReleaseSha: candidate ?? null,
  }
}

export function parseAiControlArgs(argv: readonly string[]): Parsed | null {
  const [rawAction, rawScope, ...values] = positionalArgs(argv)
  if (
    !rawAction ||
    !rawScope ||
    !(['inspect', 'kill', 'drain', 'restore'] as const).includes(rawAction as Action)
  ) {
    return null
  }
  const action = rawAction as Action
  if (rawScope === 'global') {
    if (values.length !== 0) return null
    return {
      action,
      scope: { kind: 'global' },
      scopeKey: 'global',
      providerDeploymentProfileVersion: null,
      candidateReleaseSha: null,
    }
  }
  // Persisted scoped heads still fence operations and need a recovery path.
  if (action !== 'inspect' && action !== 'restore') return null
  switch (rawScope) {
    case 'provider':
      return parseProviderControl(action, values)
    case 'capability':
      return parseCapabilityControl(action, values)
    default:
      return null
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = parseAiControlArgs(argv)
  if (!command) return failUsage()
  const mutation = command.action !== 'inspect'
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation,
      destructive: mutation,
      requiresTicket: mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const db = getDb()
      const [before] = await db
        .select()
        .from(aiExecutionControlHeads)
        .where(eq(aiExecutionControlHeads.scopeKey, command.scopeKey))
        .limit(1)
      if (!before) throw new Error(`AI control head is absent: ${command.scopeKey}`)
      if (command.action === 'inspect') {
        io.out(JSON.stringify({ scopeKey: command.scopeKey, head: before }, null, 2))
        return
      }
      const target =
        command.action === 'kill'
          ? { executionState: 'killed' as const, admissionState: 'draining' as const }
          : command.action === 'drain'
            ? { executionState: 'enabled' as const, admissionState: 'draining' as const }
            : { executionState: 'enabled' as const, admissionState: 'accepting' as const }
      if (ctx.dryRun) {
        io.out(
          JSON.stringify(
            {
              action: `would_${command.action}`,
              scopeKey: command.scopeKey,
              before,
              target,
            },
            null,
            2,
          ),
        )
        io.out(`re-run with --apply --yes ${COMMAND_NAME}`)
        return
      }
      const after = await createAiControlAdapter(
        db,
        reputationReplyScopeEffects,
      ).transition({
        scope: command.scope,
        providerDeploymentProfileVersion: command.providerDeploymentProfileVersion,
        expectedControlId: before.controlId,
        expectedGeneration: before.generation,
        ...target,
        reasonCode: `operator_${command.action}`,
        actorUserId: ctx.operatorId,
        ticketReference: ctx.ticket as string,
        candidateReleaseSha: command.candidateReleaseSha,
      })
      if (!after)
        throw new Error('AI control transition lost compare-and-swap or failed policy')
      io.out(
        JSON.stringify(
          { action: command.action, scopeKey: command.scopeKey, before, after },
          null,
          2,
        ),
      )
    },
    argv,
  )
  process.exit(result.exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCommandEntrypoint(COMMAND_NAME, main)
}
