// Browser stub for #/contexts/ai/server/reply-suggestion-stream.
//
// use-reply-actions.ts (streamReplyDraft) loads the stream server function with a
// dynamic import so it stays out of first paint. In the Storybook Vite build the
// real module would leak @tanstack/start-server-core (createServerFn and
// #/composition), like #/contexts/review/server/reply, so it is aliased here
// (see .storybook/main.ts). Lazy client transport must never load composition or
// Node's server runtime in stories.
//
// Unscripted, the endpoint answers what a provider outage answers (`refused`),
// which is also the one answer that needs nothing from the review. A story about
// what a draft ANSWERS scripts it for its own run with `scriptReplySuggestionStream`
// and writes the events the endpoint writes, so it drives the real session owner
// (`reply-draft-session.ts`) rather than a copy of it. The composer no longer calls
// the `generateReplySuggestion` RPC for a draft once the pane's session exists;
// that RPC now serves the governed template only.
import type { ReplyDraftingStreamEvent } from '#/contexts/ai/server/reply-progress-stream.server'
import type { DraftStreamRequest } from '#/components/inbox/reply-draft-stream'

type StreamInput = Readonly<{ data: DraftStreamRequest; signal?: AbortSignal }>
type StreamAnswer = (input: StreamInput) => Response | Promise<Response>

/** The endpoint's wire format: one JSON event per line. */
export function draftStreamResponse(
  events: ReadonlyArray<ReplyDraftingStreamEvent>,
): Response {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(''), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

const refused: StreamAnswer = () =>
  draftStreamResponse([
    {
      sequence: 1,
      step: 'refused',
      reason: 'provider_unavailable',
      retryAfterEpochMillis: null,
    },
  ])

let scripted: StreamAnswer | null = null

/**
 * Script what the endpoint answers. Returns the function that puts the default
 * back: a story's `beforeEach` returns it, so the script ends with the story.
 */
export function scriptReplySuggestionStream(answer: StreamAnswer): () => void {
  scripted = answer
  return () => {
    if (scripted === answer) scripted = null
  }
}

export async function generateReplySuggestionStreamFn(
  input: StreamInput,
): Promise<Response> {
  return (scripted ?? refused)(input)
}
