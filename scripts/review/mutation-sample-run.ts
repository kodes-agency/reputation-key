// Starts `pnpm mutation:sample`; the logic and its usage are in mutation-sample.ts.
import { runMutationSample } from './mutation-sample'

process.exitCode = runMutationSample(process.argv.slice(2))
