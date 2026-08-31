// Controlled publication of the identifier-only Google credential routing
// directory. Dry-run reports only the current revision metadata. Apply signs
// and atomically advances exactly one durable revision.

import { getDb } from '../../src/shared/db'
import { getEnv } from '../../src/shared/config/env'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialRoutingDirectoryPublisher } from '../../src/contexts/integration/application/google-credential-routing-directory-publisher'
import { createGoogleCredentialRoutingDirectoryPublicationStore } from '../../src/contexts/integration/infrastructure/google-credential-routing-directory.store'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:google-credential-routing-publish'
const TTL_MS = 60_000
const USAGE =
  `pnpm ${COMMAND} --operator <id> [--ticket <ref> --reason <text> ` +
  `--apply --yes ${COMMAND}]`

function summary(
  directory: Readonly<{
    revision: number
    issuedAtMs: number
    expiresAtMs: number
    digestSha256: string
    signatureKeyVersion: string
  }> | null,
) {
  return directory
    ? {
        revision: directory.revision,
        issuedAt: new Date(directory.issuedAtMs).toISOString(),
        expiresAt: new Date(directory.expiresAtMs).toISOString(),
        digestSha256: directory.digestSha256,
        signatureKeyVersion: directory.signatureKeyVersion,
      }
    : null
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      destructive: false,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const rawKeys = getEnv().GOOGLE_CREDENTIAL_ROUTING_HMAC_KEYS
      if (!rawKeys) throw new Error('Google credential routing signing keys are missing')
      const keys = createVersionedHmacKeyring(rawKeys)
      try {
        const store = createGoogleCredentialRoutingDirectoryPublicationStore(getDb())
        const current = await store.loadCurrent()
        io.out(
          JSON.stringify(
            { command: COMMAND, mode: 'report', current: summary(current) },
            null,
            2,
          ),
        )
        if (ctx.dryRun) return
        const publish = createGoogleCredentialRoutingDirectoryPublisher({
          store,
          keys,
          nowMs: Date.now,
          ttlMs: TTL_MS,
        })
        const published = await publish()
        io.out(
          JSON.stringify(
            { command: COMMAND, mode: 'apply', published: summary(published) },
            null,
            2,
          ),
        )
      } finally {
        keys.dispose()
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
