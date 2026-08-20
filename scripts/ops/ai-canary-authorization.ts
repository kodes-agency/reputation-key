import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../src/shared/db'
import {
  aiCanaryAuthorizationHeads,
  aiCanaryAuthorizations,
  aiExecutionControlHeads,
} from '../../src/shared/db/schema'
import type { AiCanaryIssueExpectation } from '../../src/contexts/ai/application/ports/ai-canary-authorization.port'
import { createAiCanaryAuthorizationAdapter } from '../../src/contexts/ai/infrastructure/adapters/ai-canary-authorization.adapter'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:ai-canary'
const USAGE =
  'pnpm ops:ai-canary <inspect|issue|revoke> <release-sha> --operator <id> [--reason <text> --ticket <ref> --apply --yes ops:ai-canary]'
const RELEASE_SHA = /^[0-9a-f]{40}$/
const CANARY_PROFILE = 'synthetic-canary-v1'
const CONTROL_SCOPES = [
  'global',
  'provider:private-beta-global-v1',
  'capability:review_analysis',
  'capability:reply_drafting',
  'capability:property_trends',
] as const
type Action = 'inspect' | 'issue' | 'revoke'

function failUsage(): never {
  throw new Error(`Usage: ${USAGE}`)
}

function parse(
  argv: readonly string[],
): Readonly<{ action: Action; releaseSha: string }> {
  const [rawAction, releaseSha, ...extra] = positionalArgs(argv)
  if (
    extra.length !== 0 ||
    !rawAction ||
    !(['inspect', 'issue', 'revoke'] as const).includes(rawAction as Action) ||
    !releaseSha ||
    !RELEASE_SHA.test(releaseSha)
  ) {
    return failUsage()
  }
  return { action: rawAction as Action, releaseSha }
}

async function readCanary(releaseSha: string) {
  const db = getDb()
  const [head] = await db
    .select()
    .from(aiCanaryAuthorizationHeads)
    .where(
      and(
        eq(aiCanaryAuthorizationHeads.releaseSha, releaseSha),
        eq(aiCanaryAuthorizationHeads.canaryProfileVersion, CANARY_PROFILE),
      ),
    )
    .limit(1)
  const authorizations = await db
    .select()
    .from(aiCanaryAuthorizations)
    .where(
      and(
        eq(aiCanaryAuthorizations.releaseSha, releaseSha),
        eq(aiCanaryAuthorizations.canaryProfileVersion, CANARY_PROFILE),
      ),
    )
    .orderBy(desc(aiCanaryAuthorizations.authorizationGeneration))
    .limit(3)
  return { head: head ?? null, authorizations }
}

async function readIssueExpectation(
  releaseSha: string,
): Promise<AiCanaryIssueExpectation> {
  const db = getDb()
  const state = await readCanary(releaseSha)
  const controls = await db
    .select()
    .from(aiExecutionControlHeads)
    .where(inArray(aiExecutionControlHeads.scopeKey, [...CONTROL_SCOPES]))
  const byScope = new Map(controls.map((control) => [control.scopeKey, control]))
  const global = byScope.get('global')
  const provider = byScope.get('provider:private-beta-global-v1')
  const reviewAnalysis = byScope.get('capability:review_analysis')
  const replyDrafting = byScope.get('capability:reply_drafting')
  const propertyTrends = byScope.get('capability:property_trends')
  if (
    controls.length !== CONTROL_SCOPES.length ||
    !global ||
    !provider ||
    !reviewAnalysis ||
    !replyDrafting ||
    !propertyTrends
  ) {
    throw new Error('AI canary control tuple is incomplete')
  }
  return Object.freeze({
    headGeneration:
      state.head?.state === 'issued'
        ? state.head.transitionGeneration - 1
        : (state.head?.transitionGeneration ?? 1),
    stopFence: Object.freeze({
      globalControlId: global.controlId,
      globalGeneration: global.generation,
      providerControlId: provider.controlId,
      providerGeneration: provider.generation,
      allCapabilityStopFences: Object.freeze([
        Object.freeze({
          capability: 'review_analysis' as const,
          capabilityControlId: reviewAnalysis.controlId,
          capabilityGeneration: reviewAnalysis.generation,
        }),
        Object.freeze({
          capability: 'reply_drafting' as const,
          capabilityControlId: replyDrafting.controlId,
          capabilityGeneration: replyDrafting.generation,
        }),
        Object.freeze({
          capability: 'property_trends' as const,
          capabilityControlId: propertyTrends.controlId,
          capabilityGeneration: propertyTrends.generation,
        }),
      ]),
    }),
  })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = parse(argv)
  let headerPending = true
  const operatorIo = Object.freeze({
    out(line: string) {
      const stream = headerPending ? process.stderr : process.stdout
      headerPending = false
      stream.write(`${line}\n`)
    },
    err(line: string) {
      process.stderr.write(`${line}\n`)
    },
  })
  const mutation = command.action !== 'inspect'
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation,
      destructive: command.action === 'revoke',
      requiresTicket: mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const before = await readCanary(command.releaseSha)
      if (command.action === 'inspect') {
        io.out(JSON.stringify({ releaseSha: command.releaseSha, ...before }, null, 2))
        return
      }
      if (ctx.dryRun) {
        io.out(
          JSON.stringify(
            {
              action: `would_${command.action}`,
              releaseSha: command.releaseSha,
              before,
            },
            null,
            2,
          ),
        )
        io.out(
          command.action === 'revoke'
            ? `re-run with --apply --yes ${COMMAND_NAME}`
            : 're-run with --apply',
        )
        return
      }

      const adapter = createAiCanaryAuthorizationAdapter(getDb())
      if (command.action === 'issue') {
        const expected = await readIssueExpectation(command.releaseSha)
        const currentAuthorization =
          before.head?.state === 'issued'
            ? before.authorizations.find(
                (authorization) =>
                  authorization.id === before.head?.currentAuthorizationId,
              )
            : undefined
        const issued = await adapter.issue({
          releaseSha: command.releaseSha,
          canaryProfileVersion: CANARY_PROFILE,
          expected,
          nonce: currentAuthorization?.nonce ?? randomBytes(32).toString('hex'),
          // `ctx.operatorId` exists only after the operator harness byte-matches
          // --operator against OPS_OPERATOR_IDENTITIES and ExecutionPolicy
          // allows/audits this global command.
          operatorUserId: ctx.operatorId,
        })
        if (issued.status !== 'issued') {
          throw new Error('AI canary authorization is not eligible for issue')
        }
        // The canary entry point parses its stdin with a STRICT schema whose
        // top level is exactly {operationId, permitId, attemptNumber,
        // deadlineEpochMillis, binding}. `issued.claim` also carries a
        // convenience top-level releaseSha (the authoritative copy lives in
        // binding.releaseSha, which the canary constant-compares against its
        // own RELEASE_SHA), and emitting it made every canary run fail input
        // validation. Emit the wire shape only.
        const { releaseSha: claimReleaseSha, ...wireClaim } = issued.claim
        if (claimReleaseSha !== issued.claim.binding.releaseSha) {
          throw new Error('AI canary claim release SHA is inconsistent')
        }
        io.out(JSON.stringify(wireClaim))
        return
      }

      const authorizationId = before.head?.currentAuthorizationId
      if (!authorizationId || before.head?.state !== 'issued') {
        throw new Error('AI canary authorization is not currently issued')
      }
      const revoked = await adapter.revoke({
        authorizationId,
        expectedHeadGeneration: before.head.transitionGeneration,
      })
      if (revoked.status !== 'revoked') {
        throw new Error('AI canary authorization revoke lost compare-and-swap')
      }
      io.out(
        JSON.stringify({
          action: 'revoked',
          releaseSha: command.releaseSha,
          state: await readCanary(command.releaseSha),
        }),
      )
    },
    argv,
    operatorIo,
  )
  process.exitCode = result.exitCode
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
  process.exitCode = 1
})
