import { readFile, stat } from 'node:fs/promises'
import { getDb } from '../../src/shared/db'
import {
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentApprovalBundle,
  parseGoogleContentRolePublicKeys,
  validateGoogleContentApprovalBundle,
} from '../../src/shared/auth/google-content-approval'
import { createGoogleContentApprovalInstaller } from '../../src/shared/auth/google-content-authority'
import { createGoogleContentAuthorityRepository } from '../../src/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import { runOperatorCommand } from './operator-command'

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024
const PUBLIC_KEYS_ENV = 'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON'
const USAGE =
  'pnpm ops:google-content-approval <bundle.json> --operator <id> [--reason <text> --ticket <ref> --apply]'

async function readJsonFile(path: string): Promise<unknown> {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size > MAX_BUNDLE_BYTES) {
    throw new Error('approval_bundle_invalid')
  }
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error('approval_bundle_invalid')
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('approval_bundle_invalid')
  }
}

function readPublicKeys(): unknown {
  const raw = process.env[PUBLIC_KEYS_ENV]
  if (!raw || Buffer.byteLength(raw, 'utf8') > 100 * 1024) {
    throw new Error('approval_public_keys_unavailable')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('approval_public_keys_unavailable')
  }
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:google-content-approval',
      scope: 'global',
      mutation: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      if (args.positionals.length !== 1) {
        io.err(`Usage: ${USAGE}`)
        return 1
      }

      let bundleInput: unknown
      let publicKeysInput: unknown
      try {
        bundleInput = await readJsonFile(args.positionals[0]!)
        publicKeysInput = readPublicKeys()
      } catch (error) {
        io.err(error instanceof Error ? error.message : 'approval_input_invalid')
        return 1
      }

      const parsedBundle = parseGoogleContentApprovalBundle(bundleInput)
      const parsedPublicKeys = parseGoogleContentRolePublicKeys(publicKeysInput)
      if (!parsedBundle.ok || !parsedPublicKeys.ok) {
        io.err('approval_input_invalid')
        return 1
      }

      const verifyRoleApproval = createGoogleContentRoleSignatureVerifier(
        parsedPublicKeys.publicKeys,
      )
      const validation = validateGoogleContentApprovalBundle(
        parsedBundle.bundle,
        new Date(),
        verifyRoleApproval,
      )
      if (!validation.ok) {
        io.err(`approval_refused code=${validation.code}`)
        return 1
      }

      const binding = validation.binding
      if (ctx.dryRun) {
        // routeCatalogue is approval-bound: the bundle must carry the exact
        // compiled GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION or parsing above
        // already refused it. Printed so the operator can confirm which
        // catalogue this approval authorizes.
        io.out(
          `validated capability=${binding.capability} phase=${binding.targetPhase} release=${binding.releaseSha} routeCatalogue=${binding.routeCatalogueVersion} performanceCatalog=${binding.performanceCatalogVersion} expires=${binding.expiresAt}; re-run with --apply`,
        )
        return
      }

      const installer = createGoogleContentApprovalInstaller({
        store: createGoogleContentAuthorityRepository(getDb()),
        clock: () => new Date(),
        verifyRoleApproval,
      })
      const installed = await installer.installApproval(parsedBundle.bundle)
      if (!installed.ok) {
        io.err(`approval_refused code=${installed.code}`)
        return 1
      }
      io.out(
        `approval_installed capability=${binding.capability} phase=${binding.targetPhase} routeCatalogue=${binding.routeCatalogueVersion} binding=${installed.approvalBindingId}`,
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error('ops Google Content approval failed', error)
  process.exit(1)
})
