// Node --import entry: initialize before BullMQ worker application imports.
import 'dotenv/config'
import { initObservability } from './telemetry'

initObservability('worker')
