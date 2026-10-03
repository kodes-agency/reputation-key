import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { formatDate } from '#/lib/format'

/**
 * What people call a Google connection: the address of the Google account it
 * authorizes. A connection made before RepKey asked for that address has none
 * until it is authorized again, so it is told apart by when it was connected.
 */
export function googleConnectionLabel(
  connection: Pick<GoogleConnectionDto, 'accountEmail' | 'createdAt'>,
): string {
  if (connection.accountEmail) return connection.accountEmail
  const connectedOn = formatDate(connection.createdAt)
  return connectedOn === null
    ? 'Google account'
    : `Google account connected ${connectedOn}`
}
