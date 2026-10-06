// A calendar day as "29 Sep 2026", in UTC.
//
// Built from the date's parts rather than Intl: the members page is server
// rendered, and engines disagree on an abbreviated month (Node prints "Sept"
// for en-GB where other engines print "Sep"), which would hydrate to a
// different string than the server sent. UTC so the viewer's zone cannot move
// the day either.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function formatInvitationDay(value: Date): string {
  const month = MONTHS[value.getUTCMonth()] ?? ''
  return `${value.getUTCDate()} ${month} ${value.getUTCFullYear()}`
}
