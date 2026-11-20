// "Remove from workspace" — Archive followed by a Google disconnect.
//
// These are two sanctioned lifecycle commands, each authorized on its own. They
// are composed here rather than behind a new server function so the operator
// confirms once while the audited commands stay exactly as they are.

export type RemovePropertyInput = Readonly<{
  data: Readonly<{ propertyId: string; reason: string }>
}>

export type RemovePropertyResult = Readonly<{ googleDisconnected: boolean }>

export type RemovePropertyCommands = Readonly<{
  archive: (
    input: RemovePropertyInput,
  ) => Promise<Readonly<{ property: Readonly<{ googleBindingState: string }> }>>
  disconnect: (
    input: Readonly<{ data: Readonly<{ propertyId: string }> }>,
  ) => Promise<unknown>
}>

export async function removePropertyFromWorkspace(
  input: RemovePropertyInput,
  commands: RemovePropertyCommands,
): Promise<RemovePropertyResult> {
  const archived = await commands.archive(input)
  // Only an active binding can be disconnected; anything else is already clean,
  // and asking would fail on a Property that never finished connecting.
  if (archived.property.googleBindingState !== 'active') {
    return Object.freeze({ googleDisconnected: true })
  }
  try {
    await commands.disconnect({ data: { propertyId: input.data.propertyId } })
    return Object.freeze({ googleDisconnected: true })
  } catch {
    // Archiving already removed the Property from the workspace and stopped its
    // provider work, so failing the whole action would misreport what happened.
    // The caller names the unfinished half instead of hiding it.
    return Object.freeze({ googleDisconnected: false })
  }
}
