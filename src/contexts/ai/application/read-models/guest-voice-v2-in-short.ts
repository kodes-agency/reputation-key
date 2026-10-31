import type { GuestVoiceIssueGroup } from './guest-voice-v2-facts'
import { issueTitle } from './guest-voice-v2-titles'
// "In short": the page in up to three lines, from fixed sentence patterns filled with
// the analysis's own numbers (decision Q9). There is no model in it, so there is no
// wording the figures below could contradict. Each line is "Lead: rest" because the page
// sets the lead in bold (`splitLead`).
import type {
  ChangedItem,
  FixFirstItem,
  GuestsLoveItem,
  InShortLine,
} from './guest-voice-v2'

function averageClause(mentionedAverage: number | null): string {
  return mentionedAverage === null
    ? ''
    : ` Those reviews average ${mentionedAverage.toFixed(1)}★.`
}

function topProblemLine(item: FixFirstItem): InShortLine {
  const cause = item.causes.at(0)
  const mostly = cause === undefined ? '' : `, most often “${cause.toLowerCase()}”`
  return {
    kind: 'fix_first',
    issueId: item.issueId,
    topic: item.topic,
    text: `${item.title} is the top problem: ${item.statistics.shareText} reviews${mostly}.${averageClause(item.statistics.mentionedAverage)}`,
  }
}

function topStrengthLine(item: GuestsLoveItem): InShortLine {
  return {
    kind: 'protect',
    issueId: item.issueId,
    topic: item.topic,
    text: `${item.title} is what guests praise most: ${item.statistics.shareText} reviews.`,
  }
}

function changeLead(item: ChangedItem): string {
  const direction = item.change === 'rising' ? 'rising' : 'falling'
  return item.polarity === 'complaint'
    ? `${item.title} complaints are ${direction}`
    : `Praise for ${item.title} is ${direction}`
}

function changeLine(item: ChangedItem): InShortLine {
  const often = item.change === 'rising' ? 'more often' : 'less often'
  return {
    kind: 'change',
    issueId: item.issueId,
    topic: item.topic,
    text: `${changeLead(item)}: ${item.statistics.shareText} reviews now, ${often} than in the 12 months before.`,
  }
}

/**
 * The top problem, the top strength and the first thing that moved, as far as each
 * exists. A page whose figures may still move (`provisional`) claims no change.
 */
export function inShortLines(
  sections: Readonly<{
    fixFirst: readonly FixFirstItem[]
    guestsLove: readonly GuestsLoveItem[]
    whatChanged: readonly ChangedItem[]
  }>,
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>,
): readonly InShortLine[] {
  const summaryItem = <T extends { issueId: string; title: string }>(item: T): T => {
    const group = groups.get(item.issueId)
    return group ? { ...item, title: issueTitle(group) } : item
  }
  const lines: InShortLine[] = []
  const problem = sections.fixFirst.at(0)
  const strength = sections.guestsLove.at(0)
  const change = sections.whatChanged.at(0)
  if (problem !== undefined) lines.push(topProblemLine(summaryItem(problem)))
  if (strength !== undefined) lines.push(topStrengthLine(summaryItem(strength)))
  if (change !== undefined) lines.push(changeLine(summaryItem(change)))
  return lines
}
