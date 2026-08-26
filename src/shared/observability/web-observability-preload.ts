// Node --import entry: initialize before Nitro/TanStack server imports.
import 'dotenv/config'
import { initObservability } from './telemetry'

initObservability('web')
