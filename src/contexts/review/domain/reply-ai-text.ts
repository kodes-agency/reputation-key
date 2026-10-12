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
// Each command therefore states which of three things it does with AI text:
//
//   - it moves the unedited text toward Google, so the binding must be current
//     (submit, Confirm & Publish; the publish worker's claim reads the same
//     binding for as long as the Reply is still AI-assisted);
//   - it is a manager acting on the text as their own, which ends the adoption:
//     the Reply is recorded as human-authored and its AI provenance is cleared
//     (a draft save, Try publishing again, edit-and-republish);
//   - it does neither, and never reads the binding (reject, delete, recording
//     a provider confirmation).
//
// Authorship is the durable record of this. `ai_assisted` means "still held by
// the binding": the schema requires an expiry on every such row, and the AI
// draft purge and the worker's claim both act on that label. So a Reply that
// leaves the binding leaves the label, through the one mechanism that already
// did it for a typed-over draft (reply-set-clause.ts, `aiGenerated: false`).

import type { ReplyCommand } from './reply-command-preconditions'

export type AiTextRule =
  /** Moves unedited AI text toward Google: refused while its binding is stale. */
  | 'needs_current_binding'
  /** A manager's own act on the text: the Reply becomes human-authored. */
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
  // The text was confirmed by a manager once already. Sending it again is
  // that manager's, or another's, own command; it is not the AI's text moving
  // forward by itself, and it must not wait on a window that closed long ago.
  retry_publication: 'ends_adoption',
  // The manager typed the new text.
  edit_published: 'ends_adoption',
  delete: 'unaffected',
  // Provider truth: what Google shows does not depend on the binding.
  confirm_published: 'unaffected',
}

export const aiTextRuleOf = (command: ReplyCommand): AiTextRule =>
  REPLY_COMMAND_AI_TEXT_RULES[command]
