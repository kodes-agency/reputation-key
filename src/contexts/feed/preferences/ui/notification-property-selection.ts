export function notificationPropertyScopeKey(
  properties: readonly Readonly<{ id: string }>[],
): string {
  return JSON.stringify(properties.map(({ id }) => id).sort())
}
