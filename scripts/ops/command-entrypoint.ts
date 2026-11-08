export async function runCommandEntrypoint(
  commandName: string,
  main: () => Promise<void>,
): Promise<void> {
  try {
    await main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${commandName} failed: ${message}\n`)
    process.exit(1)
  }
}
