// Portal command stores — the print code hashes of a code row (ADR 0069).
//
// What a store may take on trust about the two hashes it writes, and what it
// answers when a unique index refuses one. The hashes are credentials, so nothing
// here names one: the refusal is the typed error and nothing else.

import { portalError } from '../domain/errors'
import { isUniqueViolation } from './portal-unique-violation'

/** The CHECKs of migration 0070: 64 lowercase hex characters, an HMAC-SHA256. */
const HASH_FORMAT = /^[0-9a-f]{64}$/u

/** Both hashes are well formed and they differ: one code row never stores a hash twice. */
export function areWellFormedPrintCodeHashes(
  hashes: Readonly<{ qr: string; nfc: string }>,
): boolean {
  return (
    HASH_FORMAT.test(hashes.qr) &&
    HASH_FORMAT.test(hashes.nfc) &&
    hashes.qr !== hashes.nfc
  )
}

/** The two partial unique indexes of migration 0070. */
const PRINT_CODE_HASH_UNIQUES = [
  'portal_tokens_qr_print_code_hash_key',
  'portal_tokens_nfc_print_code_hash_key',
] as const

/** Whether the database refused a write because an index already holds a print code hash. */
const isPrintCodeCollision = (error: unknown): boolean =>
  PRINT_CODE_HASH_UNIQUES.some((constraint) => isUniqueViolation(error, constraint))

/** The refusal a collision gives the manager: nothing about the code, only to try again. */
const printCodeCollision = () =>
  portalError('print_code_collision', 'The new code could not be saved. Try again.')

/** Runs the write and answers `print_code_collision` when an index holds the hash. */
export async function refusingPrintCodeCollision<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    throw isPrintCodeCollision(error) ? printCodeCollision() : error
  }
}
