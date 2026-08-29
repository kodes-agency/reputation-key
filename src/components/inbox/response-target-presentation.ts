import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'

export type ResponseTargetPresentation = Readonly<{
  title: string
  status: string
  description: string
  dueLabel: string | null
  tone: 'neutral' | 'attention' | 'success' | 'muted'
}>

function targetTitle(kind: ResponseTargetView['targetKind']): string {
  return kind === 'google_review_response'
    ? 'Google review response target'
    : 'Private feedback handling target'
}

function dueLabel(target: ResponseTargetView): string | null {
  if (!target.dueAt) return null
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: target.propertyTimezone,
  }).format(target.dueAt)
}

function excludedPresentation(
  target: ResponseTargetView,
  title: string,
): ResponseTargetPresentation {
  const legacyDescription =
    target.targetKind === 'google_review_response'
      ? 'Reliable timing is unavailable for this earlier review cycle, so it is not included in target reporting.'
      : 'Reliable timing is unavailable for this earlier feedback cycle, so it is not included in target reporting.'
  return {
    title,
    status: 'Not measured',
    description:
      target.eligibility === 'historical_onboarding'
        ? 'This review was imported as onboarding history, so its earlier response time is not included in target reporting.'
        : legacyDescription,
    dueLabel: null,
    tone: 'muted',
  }
}

function cancelledPresentation(
  target: ResponseTargetView,
  title: string,
): ResponseTargetPresentation {
  return {
    title,
    status: 'Cancelled',
    description: 'This cycle is excluded from response-target reporting.',
    dueLabel: dueLabel(target),
    tone: 'muted',
  }
}

function completedDescription(target: ResponseTargetView, onTime: boolean): string {
  if (target.targetKind === 'google_review_response') {
    return onTime
      ? 'A current response was observed live on Google within the saved target.'
      : 'A current response was observed live on Google after the saved target and remains included in reporting.'
  }
  return onTime
    ? 'The feedback handling cycle was completed within its saved target.'
    : 'The feedback handling cycle was completed and remains included in reporting.'
}

function completedPresentation(
  target: ResponseTargetView,
  title: string,
): ResponseTargetPresentation {
  const onTime = target.result === 'on_time'
  return {
    title,
    status: onTime ? 'Completed within target' : 'Completed after target',
    description: completedDescription(target, onTime),
    dueLabel: dueLabel(target),
    tone: onTime ? 'success' : 'neutral',
  }
}

function overduePresentation(
  target: ResponseTargetView,
  title: string,
): ResponseTargetPresentation {
  return {
    title,
    status: 'Target time passed',
    description: 'The item remains open for follow-up. Escalation is managed separately.',
    dueLabel: dueLabel(target),
    tone: 'attention',
  }
}

function inProgressPresentation(
  target: ResponseTargetView,
  title: string,
): ResponseTargetPresentation {
  return {
    title,
    status: 'In progress',
    description:
      target.targetKind === 'google_review_response'
        ? 'Timing starts from the saved Google publication, meaningful review update, or reopen time for this cycle.'
        : 'Timing starts from the feedback submission or reopen time for this cycle.',
    dueLabel: dueLabel(target),
    tone: 'neutral',
  }
}

export function presentResponseTarget(
  target: ResponseTargetView,
): ResponseTargetPresentation {
  const title = targetTitle(target.targetKind)
  if (target.evaluation.state === 'excluded') return excludedPresentation(target, title)
  if (target.evaluation.state === 'cancelled') return cancelledPresentation(target, title)
  if (target.evaluation.state === 'completed') return completedPresentation(target, title)
  if (target.evaluation.overdue) return overduePresentation(target, title)
  return inProgressPresentation(target, title)
}
