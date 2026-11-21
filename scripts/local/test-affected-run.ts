// Starts `pnpm test:affected`; the logic and its usage are in test-affected.ts.
import { runAffectedTests } from './test-affected'

process.exitCode = runAffectedTests(process.argv.slice(2))
