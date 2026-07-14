// Event schema registry — Zod-validated event contracts for the outbox (PRE17A A3).
//
// Every event type that flows through the outbox must be registered with a
// Zod schema. The relay validates before enqueue; the dispatcher validates
// before consumption. Unknown types are rejected.
//
// Events are identifier-only (ADR 0030): payloads carry IDs and stable facts
// only. Review text, reviewer identity, reply text, prompt content, and
// provider output are never in event payloads.

import type { z } from 'zod'

// ── Registry types ──────────────────────────────────────────────────

export type EventSchemaEntry = Readonly<{
  /** Event type string (e.g., 'review.received'). */
  readonly type: string
  /** Schema version. Incremented when the payload shape changes. */
  readonly version: number
  /** Zod schema for the payload. Identifier-only. */
  readonly schema: z.ZodType<unknown>
}>

// ── Registry ────────────────────────────────────────────────────────

const registry = new Map<string, EventSchemaEntry>()

/**
 * Register an event schema. Called during context build.
 * Throws if a duplicate type+version is already registered.
 */
export function registerEventSchema(entry: EventSchemaEntry): void {
  const key = `${entry.type}:v${entry.version}`
  if (registry.has(key)) {
    throw new Error(
      `Duplicate event schema: ${key} is already registered. ` +
        'Each event type+version must be registered exactly once.',
    )
  }
  registry.set(key, entry)
}

/**
 * Look up the schema for an event type and version.
 * Returns undefined for unknown types — the caller must reject.
 */
export function getEventSchema(
  type: string,
  version: number,
): EventSchemaEntry | undefined {
  return registry.get(`${type}:v${version}`)
}

/**
 * Validate a payload against its registered schema.
 * Returns the parsed payload or throws ZodError.
 * Throws if the event type+version is not registered.
 */
export function validateEventPayload(
  type: string,
  version: number,
  payload: unknown,
): unknown {
  const entry = getEventSchema(type, version)
  if (!entry) {
    throw new Error(
      `Unknown event type: ${type}:v${version}. Register the schema before emitting.`,
    )
  }
  return entry.schema.parse(payload)
}

/**
 * Check if an event type+version is registered.
 */
export function isEventRegistered(type: string, version: number): boolean {
  return registry.has(`${type}:v${version}`)
}

/** Clear all registrations — useful for tests. */
export function clearEventSchemas(): void {
  registry.clear()
}
