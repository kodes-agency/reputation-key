import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'

// UTC keeps the server render and the browser on the same calendar day.
const connectedOn = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

/**
 * What people call a Google connection: the address of the Google account it
 * authorizes. A connection made before RepKey asked for that address has none
 * until it is authorized again, so it is told apart by when it was connected.
 */
export function googleConnectionLabel(
  connection: Pick<GoogleConnectionDto, 'accountEmail' | 'createdAt'>,
): string {
  if (connection.accountEmail) return connection.accountEmail
  return `Google account connected ${connectedOn.format(new Date(connection.createdAt))}`
}
