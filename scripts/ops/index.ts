import { spawnSync } from 'node:child_process'
import { COMMANDS } from './commands'

function printCommands(): void {
  const names = Object.keys(COMMANDS).sort()
  const width = Math.max(...names.map((name) => name.length))
  console.log('Available operator commands:')
  for (const name of names) {
    console.log(`  ${name.padEnd(width)}  tsx ${COMMANDS[name]?.join(' ')}`)
  }
}

const [name, ...args] = process.argv.slice(2)
if (!name) {
  printCommands()
  process.exit(0)
}

const command = COMMANDS[name]
if (!command) {
  console.error(`Unknown operator command: ${name}`)
  printCommands()
  process.exit(1)
}

const [file, ...defaultArgs] = command
const result = spawnSync('tsx', [file, ...defaultArgs, ...args], { stdio: 'inherit' })
if (result.error) {
  console.error(`Failed to start ${name}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
