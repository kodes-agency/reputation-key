// Review context — what each reply command means for AI-assisted text.
//
// An AI-assisted Reply holds the unedited text of one AI suggestion a manager
// adopted as a draft. AI output is advisory (ADR 0031; AI CONTEXT, Invariants 5
// and 6): it reaches Google only through a manager's own Confirm & Publish.
// Until a manager has made the text their own, the AI draft binding
// (infrastructure/ai-draft-binding.ts) holds it: everything it was generated
// from must still be current, and its ten-minute adoption window must not have
// passed.
//
// The binding is a gate on AI text moving toward Google. It is not a lock on
// the Reply. When it guarded every write, a Reply ten minutes old could not be
// typed over, rejected, retried or edited, and stayed where it was for good.
//
// The binding has two halves: time (the ten-minute window) and everything the
// text was generated from. Submit and Confirm & Publish need both, and so does
// the publish worker's claim, the last step before a request leaves RepKey. A
// claim that passes writes an attempt for that text; from then on the text has
// gone through every gate while it was current, and a later attempt for it, in
// the same cycle or in the cycle of a retry, no longer waits on the window.
// That is all the earlier claim excuses. Once something the text was generated
// from has changed (AI switched off, a consent or profile change, a guest
// edit), it is text the AI draft purge withdraws wherever it still can
// (src/shared/db/ai/ai-draft-purge.ts), and the claim refuses it, claimed
// before or not.
//
// A claim that is refused withdraws the Reply, exactly as that purge would at
// its next run: the cycle is cancelled, the AI text is removed, and what is
// left is an empty draft a manager writes a new reply into
// (infrastructure/unclaimable-publication.ts).
//
// Each command therefore states which of three things it does with AI text:
//
//   - it moves the unedited text toward Google, so the binding must be current
//     (submit, Confirm & Publish);
//   - it is a manager writing the text, which ends the adoption: the Reply is
//     recorded as human-authored and its AI provenance is cleared (a draft
//     save, edit-and-republish);
//   - it does neither, and never reads the binding (reject, delete, recording
//     a provider confirmation, and Try publishing again, which changes no text
//     and leaves the decision to the claim of the cycle it authorizes).
//
// The purge is not a command and is not in this table. It is the other writer
// of AI-assisted Replies: it deletes one nobody confirmed and empties one that
// has publication evidence, from other contexts' transactions.
//
// Authorship is the durable record of where the text came from, and the
// Organization export carries it. It changes only when the text does: a Reply
// whose words are still the suggestion's stays `ai_assisted` through approval,
// failure, a retry and publication, and becomes `human` through the one
// mechanism a typed-over draft uses (reply-set-clause.ts, `aiGenerated: false`).

import type { ReplyCommand } from './reply-command-preconditions'

export type AiTextRule =
  /** Moves unedited AI text toward Google: refused while its binding is stale. */
  | 'needs_current_binding'
  /** A manager writes the text: the Reply becomes human-authored. */
  | 'ends_adoption'
  /** Neither: the binding is not read and the authorship does not change. */
  | 'unaffected'

const REPLY_COMMAND_AI_TEXT_RULES: Readonly<Record<ReplyCommand, AiTextRule>> = {
  // Typing over an AI draft, or "Edit & resubmit" on a rejected one.
  save_draft: 'ends_adoption',
  submit: 'needs_current_binding',
  approve: 'needs_current_binding',
  // An approver must always be able to send a reply back.
  reject: 'unaffected',
  // A retry changes no text, so it changes no authorship, and it authorizes a
  // cycle without sending anything. Whether the text may still go is decided
  // where it would leave: at the claim of that cycle, which asks the whole
  // binding of text that was never claimed, and everything but the window of
  // text that was.
  retry_publication: 'unaffected',
  // The manager typed the new text.
  edit_published: 'ends_adoption',
  delete: 'unaffected',
  // Provider truth: what Google shows does not depend on the binding.
  confirm_published: 'unaffected',
}

export const aiTextRuleOf = (command: ReplyCommand): AiTextRule =>
  REPLY_COMMAND_AI_TEXT_RULES[command]
