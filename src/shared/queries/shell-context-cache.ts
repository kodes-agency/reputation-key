// The browser's memory of the shell's own checks (ADR 0072).
//
// `_authenticated`'s `beforeLoad` asks who is signed in, which Organization and role
// they have, and which features are on for the Property in scope, and the controlled
// routes ask whether their feature is on. Those answers are kept in the browser's
// Query cache for `SHELL_CONTEXT_STALE_MS`, so a navigation soon after the last check
// asks the server nothing. This module holds the keys and the ways an entry is
// forgotten. It imports nothing but Query's types, because the shell and the route
// error boundary both load it in first paint.
//
// The server never reads these entries: its QueryClient is made per request
// (`getRouter`), and the shell's server path fetches and writes nothing.

import type { QueryClient } from '@tanstack/react-query'

/** How long a check answers for the next navigations. */
export const SHELL_CONTEXT_STALE_MS = 30_000

/**
 * The session is the one entry not under a person: it is the answer to who the person
 * is. Every other entry is under the user id that answer gave, so one person's role,
 * Organization or feature answer can never be read for another.
 */
export const shellContextKeys = {
  all: ['shell-context'] as const,
  session: () => [...shellContextKeys.all, 'session'] as const,
  person: (userId: string) => [...shellContextKeys.all, 'person', userId] as const,
  organization: (userId: string) =>
    [...shellContextKeys.person(userId), 'organization'] as const,
  capabilities: (userId: string, propertyId: string | null) =>
    [...shellContextKeys.person(userId), 'capabilities', propertyId ?? 'none'] as const,
  routeGate: (userId: string, capability: string, propertyId: string | null) =>
    [
      ...shellContextKeys.person(userId),
      'route-gate',
      capability,
      propertyId ?? 'none',
    ] as const,
}

type ForgettingClient = Pick<QueryClient, 'removeQueries'>

const CHANNEL_NAME = 'repkey-shell-context'
const FORGET_MESSAGE = 'forget'

/**
 * How many times this QueryClient's shell checks were forgotten. A check asked before
 * a forget may answer after it, with what was true before the change; whoever
 * remembers an answer compares this number from before the ask with the one after,
 * and keeps nothing when they differ.
 */
const generations = new WeakMap<object, number>()

export function shellContextGeneration(queryClient: object): number {
  return generations.get(queryClient) ?? 0
}

function forgetHere(queryClient: ForgettingClient): void {
  queryClient.removeQueries({ queryKey: shellContextKeys.all })
  generations.set(queryClient, shellContextGeneration(queryClient) + 1)
}

/**
 * Who is here, or what they may do, changed in a way that already emptied the cache
 * (`queryClient.clear()` on sign-in and sign-out): stop any check still in flight
 * from being remembered, and tell the person's other tabs, which forget their entries
 * and check again on their next navigation.
 */
export function shellContextForgotten(queryClient: object): void {
  generations.set(queryClient, shellContextGeneration(queryClient) + 1)
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage(FORGET_MESSAGE)
  channel.close()
}

/**
 * Forget every remembered shell check, in this tab and the person's other tabs, so the
 * next navigation asks the server. Call it after anything the shell shows or decides
 * from changes: the person's name or picture, the Organization's name, a member's role
 * or Property access, an active Organization being set. Removed rather than marked
 * stale, so nothing can read them afterwards.
 */
export function invalidateShellContext(queryClient: ForgettingClient): void {
  queryClient.removeQueries({ queryKey: shellContextKeys.all })
  shellContextForgotten(queryClient)
}

/**
 * Forget the entries whenever this tab may have missed a change: when it becomes
 * visible again (another tab may have signed out, or in as someone else, while it was
 * hidden) and when another tab announces one. Browser only; returns the unsubscribe.
 */
export function forgetShellContextOnReturn(queryClient: ForgettingClient): () => void {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') forgetHere(queryClient)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === FORGET_MESSAGE) forgetHere(queryClient)
    }
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    channel?.close()
  }
}

/**
 * Which side a route option runs on. Only the browser remembers: the server answers
 * one request and must never answer the next from it.
 */
export function shellCheckSide(): 'server' | 'browser' {
  return typeof document === 'undefined' ? 'server' : 'browser'
}
