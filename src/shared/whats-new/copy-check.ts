import { PRODUCT_UPDATE_ICONS, PRODUCT_UPDATE_ROUTES, type ProductUpdate } from './types'

const TECHNICAL =
  /\b(?:deploy|deployment|release|build|model|prompt|schema|migration|database|api|endpoint|cache|token|sha|commit|pr|pull request|refactor|backend|frontend|server|latency|bug|flag|epoch|runtime|json|sql|sentry|railway|codex|claude)\b/iu
const CODE =
  /`|#[0-9]+|(?:^|\s)(?:\.?\.?\/|[a-zA-Z]:\\)|\b[\w-]+\/[\w$./-]+|\b\w+\.(?:tsx?|jsx?|sql|json|ya?ml)\b|[{}]|=>|<\/?\w+>|\b(?:const|let|var)\s+\w+\s*=|\bfunction\s+\w+\s*\(|\b\w+\.\w+\(/u
type CopyEntry = Omit<ProductUpdate, 'icon' | 'showMe'> & {
  icon: string
  showMe?: { to: string; needsProperty?: boolean }
}

function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

function entryCopyProblems(entry: CopyEntry): string[] {
  const problems: string[] = []
  const fail = (reason: string) => problems.push(`${entry.id}: ${reason}`)
  if (entry.title.length > 60) fail('title exceeds 60 characters')
  if (entry.body.length > 200) fail('body exceeds 200 characters')
  if (
    (entry.body.match(/[^.!?]+(?:[.!?]+|$)/gu) ?? []).filter((sentence) =>
      sentence.trim(),
    ).length > 2
  )
    fail('body exceeds two sentences')
  if (entry.kind === 'highlight' && !entry.body.trim()) fail('highlight needs a body')
  if (TECHNICAL.test(`${entry.title} ${entry.body}`)) fail('technical copy')
  if (CODE.test(`${entry.title} ${entry.body}`)) fail('code, path or ticket reference')
  if (!PRODUCT_UPDATE_ICONS.some((icon) => icon === entry.icon)) fail('unknown icon')
  if (entry.showMe && !PRODUCT_UPDATE_ROUTES.some((route) => route === entry.showMe?.to))
    fail('unknown route')
  if (entry.showMe?.to.includes('$propertyId') && !entry.showMe.needsProperty)
    fail('property link needs a property')
  return problems
}

export function productUpdateCopyProblems(entries: readonly CopyEntry[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  let previous = ''
  for (const entry of entries) {
    const fail = (reason: string) => problems.push(`${entry.id}: ${reason}`)
    if (seen.has(entry.id)) fail('duplicate id')
    seen.add(entry.id)
    if (!validDate(entry.publishedOn)) fail('invalid date')
    if (entry.publishedOn < previous) fail('unsorted date')
    previous = entry.publishedOn
    if (
      !entry.id.startsWith(`${entry.publishedOn}-`) ||
      !/^[a-z0-9-]+$/.test(entry.id) ||
      entry.id.split('-').some((part) => !part)
    )
      fail('invalid id')
    problems.push(...entryCopyProblems(entry))
  }
  return problems
}
