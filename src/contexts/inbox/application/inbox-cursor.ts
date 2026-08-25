import { inboxItemId } from '#/shared/domain/ids'
import type { Cursor } from './ports/inbox.repository'

const MAX_ENCODED_CURSOR_LENGTH = 512
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Decode the browser's `btoa(JSON.stringify(cursor))` wire representation. */
export function decodeInboxCursor(encoded: string): Cursor | null {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CURSOR_LENGTH) {
    return null
  }

  try {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength === 0 || bytes.toString('base64') !== encoded) return null
    const value = JSON.parse(bytes.toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

    const { sourceDate, id } = value as { sourceDate?: unknown; id?: unknown }
    if (typeof sourceDate !== 'string' || typeof id !== 'string' || !UUID.test(id)) {
      return null
    }

    const parsedDate = new Date(sourceDate)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== sourceDate) {
      return null
    }

    return { sourceDate: parsedDate, id: inboxItemId(id) }
  } catch {
    return null
  }
}
