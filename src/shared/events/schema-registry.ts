// Event payload validation — Zod-validated event contracts for the outbox.
//
// Every event type that flows through the outbox is defined in the descriptor
// files and looked up through `./registry.server`. The relay validates before
// enqueue; the dispatcher validates before consumption. Unknown types are
// rejected.
//
// Events are identifier-only (ADR 0030): payloads carry IDs and stable facts
// only. Review text, reviewer identity, reply text, prompt content, and
// provider output are never in event payloads.

import { getEventDescriptor } from './registry.server'

/**
 * Validate a payload against its schema.
 * Returns the parsed payload or throws ZodError.
 * Throws if the event type+version is not defined.
 */
export function validateEventPayload(
  type: string,
  version: number,
  payload: unknown,
): unknown {
  const entry = getEventDescriptor(type, version)
  if (!entry) throw new Error(`Unknown event type: ${type}:v${version}.`)
  return entry.schema.parse(payload)
}
