/** `--help` anywhere in the arguments prints usage and exits 0, before any settings are read. */
export function exitIfHelp(argv: readonly string[], usage: string): void {
  if (!argv.includes('--help')) return
  console.log(`usage: ${usage}`)
  process.exit(0)
}

/** Prints the usage line to stderr and exits 1, for a missing or malformed argument. */
export function exitWithUsage(usage: string): never {
  console.error(`Usage: ${usage}`)
  process.exit(1)
}
