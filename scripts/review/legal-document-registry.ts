/**
 * `pnpm check:legal-registry` — the gate that makes counsel approval real.
 *
 * It fails the build when the repository and the legal record disagree in
 * any direction: a document whose bytes no longer match the digest counsel
 * was given, a document under `docs/legal/` that nobody registered, a
 * registry row pointing at a file that no longer exists, an approval signed
 * by anyone other than external counsel, an expired approval, or an approval
 * recorded while a counsel decision that blocks that document is still open.
 *
 * On success it prints one line of JSON naming how many documents are still
 * drafts and which counsel-owned documents block publication, mirroring
 * `scripts/review/comprehensive-program-status.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  approvalBlockingDecisionErrors,
  COUNSEL_DECISION_CHECKLIST_PATH,
  parseCounselDecisionChecklist,
  validateCounselDecisionChecklist,
} from '../../src/shared/governance/counsel-decision-checklist'
import { validateLegalDocumentRegistry } from '../../src/shared/governance/legal-approval-authority'
import {
  LEGAL_DOCUMENT_DIRECTORY,
  LEGAL_DOCUMENT_REGISTRY_PATH,
  parseLegalDocumentRegistry,
} from '../../src/shared/governance/legal-document-registry'

const ROOT = resolve(import.meta.dirname, '../..')

export type LegalRegistryCliDependencies = Readonly<{
  /** Reads a repository-relative path; throws when it is absent. */
  readFile: (path: string) => Uint8Array
  /** Repository-relative Markdown documents that must all be registered. */
  listLegalDocuments: () => readonly string[]
  now: Date
}>

function defaultDependencies(): LegalRegistryCliDependencies {
  return {
    readFile: (path) => readFileSync(resolve(ROOT, path)),
    listLegalDocuments: () =>
      readdirSync(resolve(ROOT, LEGAL_DOCUMENT_DIRECTORY))
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => `${LEGAL_DOCUMENT_DIRECTORY}/${entry}`)
        .sort(),
    now: new Date(),
  }
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function readText(path: string): string {
  return readFileSync(isAbsolute(path) ? path : resolve(ROOT, path), 'utf8')
}

export function runLegalDocumentRegistryCli(
  args: readonly string[],
  overrides: Partial<LegalRegistryCliDependencies> = {},
): number {
  const dependencies = { ...defaultDependencies(), ...overrides }
  const registryPath = flagValue(args, '--registry') ?? LEGAL_DOCUMENT_REGISTRY_PATH
  const checklistPath = flagValue(args, '--checklist') ?? COUNSEL_DECISION_CHECKLIST_PATH
  const fail = (errors: readonly string[]): number => {
    for (const error of errors) process.stderr.write(`${error}\n`)
    return 1
  }

  let registryContent: string
  let checklistContent: string
  try {
    registryContent = readText(registryPath)
    checklistContent = readText(checklistPath)
  } catch (error) {
    return fail([
      `legal document registry inputs cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }

  const registryResult = parseLegalDocumentRegistry(registryContent)
  if (!registryResult.ok) return fail(registryResult.errors)
  const checklistResult = parseCounselDecisionChecklist(checklistContent)
  if (!checklistResult.ok) return fail(checklistResult.errors)

  const { registry } = registryResult
  const { checklist } = checklistResult
  const registered = new Set(registry.documents.map((document) => document.path))
  const errors = dependencies
    .listLegalDocuments()
    .filter((path) => !registered.has(path))
    .map((path) => `unregistered legal document: ${path}`)

  const registryValidation = validateLegalDocumentRegistry({
    registry,
    readDocument: dependencies.readFile,
    now: dependencies.now,
  })
  if (!registryValidation.ok) errors.push(...registryValidation.errors)

  const checklistValidation = validateCounselDecisionChecklist({
    checklist,
    registry,
    readDocument: dependencies.readFile,
  })
  if (!checklistValidation.ok) errors.push(...checklistValidation.errors)

  errors.push(...approvalBlockingDecisionErrors(registry, checklist))

  if (errors.length > 0) return fail(errors)

  const draft = registry.documents.filter(
    (document) => document.status === 'draft',
  ).length
  process.stdout.write(
    `${JSON.stringify({
      documents: registry.documents.length,
      draft,
      approved: registry.documents.length - draft,
      blockers: registryValidation.ok ? registryValidation.blockers : [],
    })}\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runLegalDocumentRegistryCli(process.argv.slice(2))
}
