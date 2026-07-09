// Centralized domain-event ID generation.
//
// Event factories call this instead of `crypto.randomUUID()` directly so the
// source of event IDs is single + mockable in tests (vi.mock this module to
// assert deterministic IDs). Keeps `crypto` out of domain code.

export const newEventId = (): string => crypto.randomUUID()
