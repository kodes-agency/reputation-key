/** `--help` anywhere in the arguments prints usage and exits 0, before any settings are read. */
export function exitIfHelp(argv: readonly string[], usage: string): void {
  if (!argv.includes('--help')) return
  console.log(`usage: ${usage}`)
  process.exit(0)
}
