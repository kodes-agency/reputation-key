// A page the signed-in person cannot use answers inside the app shell.
//
// A role without access, a feature the beta has switched off, a Property that is
// not theirs: each used to redirect (silently, or out of the shell to `/unavailable`
// on the public chrome). They now throw a router `notFound()` that says why, and
// `_authenticated` draws it in the shell with the title of the page that was
// asked for, what is wrong, why, and a way back.
//
// `notFound()` rather than an error: the document keeps its 404 (a 500 would page
// the owner for an outcome), it serialises with server rendering, and it never
// reaches the error reporter. `routeId` aims it at the shell's boundary, so a
// nearer "this entity is gone" boundary (a missing Portal) cannot swallow it.
//
// The notice carries the cause, not the sentence. Routes throw it from first
// paint, and the sentences are read only when a refusal is drawn, so they live
// with the shell's lazy boundary (`components/layout/route-notice-copy`).
//
// `/unavailable` remains only for an account with no workspace to put a shell on.
import { notFound } from '@tanstack/react-router'
import type { CapabilityRefusalCategory } from './capability-refusal-category'

/** The one way out of a dead end. */
export type RouteBack = Readonly<{ to: string; label: string }>

/**
 * Where a refusal sends the reader: a named place, or a link of its own. The
 * places that depend on the address (`propertySettings`, `portal`) are named, not
 * linked, so the route that throws stays small and the shell's lazy boundary,
 * which reads the address, writes the link.
 */
export type RouteBackTarget =
  'properties' | 'profile' | 'propertySettings' | 'portal' | RouteBack

export type RouteNotice =
  /** The signed-in role cannot open `title`. */
  | Readonly<{
      cause: 'role'
      title: string
      back: RouteBackTarget
      /** What the sentence says the role cannot reach, when `title` does not read as a noun. */
      subject?: string
    }>
  /** The beta, the Organization or the Property has `title`'s feature switched off. */
  | Readonly<{
      cause: 'feature'
      title: string
      category: CapabilityRefusalCategory
      propertyId?: string
    }>
  /** The Property in the address is not there, or is not this Organization's. */
  | Readonly<{ cause: 'property' }>

export const PROPERTY_NOT_FOUND: RouteNotice = { cause: 'property' }

/** Answer in the app shell. Throw the result: `throw routeNotice(...)`. */
export function routeNotice(notice: RouteNotice) {
  return notFound({ routeId: '/_authenticated', data: notice })
}

/** A role that cannot open `title`. Throw the result. */
export function roleUnavailable(title: string, back: RouteBackTarget, subject?: string) {
  return routeNotice({ cause: 'role', title, back, ...(subject ? { subject } : {}) })
}
