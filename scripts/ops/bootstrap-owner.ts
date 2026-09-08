// Operator CLI (BQC-7.5): create the first Organization and its AccountAdmin
// on an empty database. Accounts are otherwise invitation-only (docs/BETA.md
// §3) and the sign-up endpoint is refused at the edge (routes/api/auth/$.ts),
// so a fresh environment — every environment starts from an empty database —
// has no first inviter without this command. It is the one operator-authored
// account: it refuses to run once any user or Organization exists, so it can
// never become a back door into a populated cell.
//
// The initial password is read from stdin (never an argument, never printed);
// the owner changes it at /settings/security or through the reset flow.
//
// Usage:
//   printf '%s' "$INITIAL_PASSWORD" | pnpm ops bootstrap-owner \
//     owner@example.com "Owner Name" "Organization Name" \
//     --operator <id> --reason <text> --ticket <ref> --apply --yes ops:bootstrap-owner
//
// Requires DATABASE_URL + BETTER_AUTH_SECRET (+ QUEUE_REDIS_URL for the harness).

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, sql } from 'drizzle-orm'
import { getAuth } from '../../src/shared/auth/auth'
import { getDb } from '../../src/shared/db'
import { account, member, organization, user } from '../../src/shared/db/schema/auth'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
} from '../../src/contexts/identity/infrastructure/adapters/better-auth-schemas'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:bootstrap-owner'
const USAGE =
  'printf %s "$INITIAL_PASSWORD" | pnpm ops bootstrap-owner <owner email> <owner name> <organization name> --operator <id> [--reason <text> --ticket <ref> --apply --yes ops:bootstrap-owner]'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const MIN_PASSWORD_LENGTH = 16

type Parsed = Readonly<{ email: string; name: string; organizationName: string }>

function usage(message: string): never {
  console.error(`${COMMAND_NAME}: ${message}`)
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

/** The three positionals; the harness owns every --flag. */
function parse(argv: readonly string[]): Parsed {
  const [rawEmail, rawName, rawOrganization, ...extra] = positionalArgs(argv)
  if (!rawEmail || !rawName || !rawOrganization || extra.length !== 0) {
    usage('expected exactly <owner email> <owner name> <organization name>')
  }
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) usage('the owner email must be an email address')
  const name = rawName.trim()
  if (name.length < 1 || name.length > 100)
    usage('the owner name must be 1-100 characters')
  const organizationName = rawOrganization.trim()
  if (organizationName.length < 1 || organizationName.length > 100) {
    usage('the organization name must be 1-100 characters')
  }
  return { email, name, organizationName }
}

function readPasswordFromStdin(): string {
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/u, '')
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    usage(`stdin must carry the initial password (${MIN_PASSWORD_LENGTH}-128 characters)`)
  }
  return password
}

function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 60)
  return slug || 'organization'
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const input = parse(argv)

  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const db = getDb()
      const [{ users }] = await db
        .select({ users: sql<number>`count(*)::int` })
        .from(user)
      const [{ organizations }] = await db
        .select({ organizations: sql<number>`count(*)::int` })
        .from(organization)
      if (users > 0 || organizations > 0) {
        throw new Error(
          `${COMMAND_NAME} runs only on an empty database (users=${users}, organizations=${organizations}); invite further accounts from the app`,
        )
      }
      if (ctx.dryRun) {
        io.out(
          JSON.stringify(
            {
              action: 'would_bootstrap_owner',
              email: input.email,
              organizationName: input.organizationName,
              slug: slugFor(input.organizationName),
              role: 'owner',
            },
            null,
            2,
          ),
        )
        io.out(
          `re-run with --apply --yes ${COMMAND_NAME} and the initial password on stdin`,
        )
        return
      }

      const password = readPasswordFromStdin()
      const signUp = await getAuth().api.signUpEmail({
        body: { name: input.name, email: input.email, password },
      })
      const userId = parseBetterAuthResponse(
        signUpResponseSchema,
        signUp,
        'registration_failed',
        `Could not create the owner account ${input.email}`,
      ).user.id
      const now = new Date()
      await db
        .update(user)
        .set({ emailVerified: true, updatedAt: now })
        .where(eq(user.id, userId))
      const [credential] = await db
        .update(account)
        .set({ password: await hashPassword(password), updatedAt: now })
        .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
        .returning({ id: account.id })
      if (!credential) throw new Error(`Credential account missing for ${input.email}`)

      const organizationId = randomUUID()
      await db.insert(organization).values({
        id: organizationId,
        name: input.organizationName,
        slug: slugFor(input.organizationName),
        createdAt: now,
      })
      await db.insert(member).values({
        id: randomUUID(),
        userId,
        organizationId,
        role: 'owner',
        createdAt: now,
      })
      io.out(
        JSON.stringify(
          {
            action: 'bootstrapped_owner',
            organizationId,
            userId,
            email: input.email,
            role: 'owner',
            next: 'sign in at /login with the initial password and change it at /settings/security',
          },
          null,
          2,
        ),
      )
    },
    argv,
  )
  process.exit(result.exitCode)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
