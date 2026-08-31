// The monitoring-client-backed observability for the sidecars that are
// allowed one: the Google egress gateway and the Google execution admission
// service.
//
// It exists as its own module so that importing it is a DECISION. The AI pair
// imports `sidecar-unmonitored-observability` instead, and because nothing in
// their graph reaches this file, the SDK never enters their bundle — which is
// what `scripts/verify-ai-runtime-image.mjs` refuses to ship.

import {
  captureObservabilityException,
  flushObservability,
  initObservability,
} from '../src/shared/observability/telemetry'
import type { SidecarStartupDependencies } from './sidecar-operational-runtime'

export const monitoredSidecarObservability: SidecarStartupDependencies = Object.freeze({
  initialize: initObservability,
  capture: captureObservabilityException,
  flush: () => flushObservability(),
  terminate: (code: 1) => process.exit(code),
})
