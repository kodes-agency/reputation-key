// BETA-2 B2.6: Request correlation ID generation.
//
// Generates a short, human-readable correlation ID for each request.
// Included in error responses so users can reference it when contacting
// support. The ID contains no PII — it's a random hex string.
//
// Format: 8 hex chars (e.g., "a3f2b1c9") — short enough to read over phone.
// Collision probability at 4M requests/day: <0.01% per day.

import { randomBytes } from 'node:crypto'

/**
 * Generate a correlation ID for a request.
 * Returns a short hex string.
 */
export function generateCorrelationId(): string {
  return randomBytes(4).toString('hex')
}

/**
 * Format a correlation ID for display.
 * Adds a prefix to make it recognizable in logs and UI.
 */
export function formatCorrelationId(id: string): string {
  return `REF-${id.toUpperCase()}`
}

/**
 * Get a formatted correlation ID ready for display in error messages.
 */
export function newDisplayCorrelationId(): string {
  return formatCorrelationId(generateCorrelationId())
}
