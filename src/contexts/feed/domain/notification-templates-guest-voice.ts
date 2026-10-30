// Feed notification surface — copy for the notices Guest voice raises.
//
// Split out of ./notification-templates.ts, which lists these renderers in its table.
// Named exports, as the account and goal notices are: a spread of an imported record
// moved a whole module's copy into first paint's chunk. This module is a leaf; its copy
// type is restated structurally below.
//
// Every sentence here is written for a notice that must carry no word of a review and no
// word about one (ADR 0046 r.8; ADR 0031): the Urgent alert says that an urgent review
// needs its reader and where, and nothing of why. The reason a model gave is read in the
// app, where the notice opens the review.
import type { NotificationPayload } from './notification-payload'

/** What a Guest voice renderer returns; assignable to the templates' own copy type. */
type GuestVoiceNoticeCopy = Readonly<{
  title: string
  body: string
  detail?: string
  actionLabel: string
  summary: string
}>

/**
 * The Urgent alert (v3 contract decision 10). The title is the sentence the owner
 * chose, led by the decision and followed by the Property, as every Property notice is
 * (templates rule 3). It names no reason, topic, rating or person, and the body only
 * says to open the review: the app says why it is urgent.
 */
export const renderReviewAiUrgentDetected = (
  p: NotificationPayload,
): GuestVoiceNoticeCopy => ({
  title:
    p.propertyName === undefined
      ? 'An urgent review needs you'
      : `An urgent review needs you at ${p.propertyName}`,
  body: 'Open it to read the review and decide what to do.',
  actionLabel: 'Open review',
  summary:
    p.propertyName === undefined ? 'urgent review' : `${p.propertyName} · urgent review`,
})
