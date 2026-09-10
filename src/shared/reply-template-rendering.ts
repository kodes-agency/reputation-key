export type ReplyTemplateRenderProfile = Readonly<{
  greeting: string
  signOffPositive: string
  signOffNegative: string
  emojiAllowed: boolean
  escalationContact: string | null
}>

export type ReplyTemplateRenderTemplate = Readonly<{ body: string }>

const GREETING_LINE = /^(?:dear|hello|hi|greetings|good (?:morning|afternoon|evening))\b/u
const TRAILING_BOUNDARY_PUNCTUATION = /[.,!?;:…'"“”„‟‘’‚‛«»‹›，。！？；：、،؛۔।॥]+$/u
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u20E3]/gu

function normalizedBoundaryLine(value: string): string {
  return value
    .trim()
    .replace(TRAILING_BOUNDARY_PUNCTUATION, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase()
}

function boundaryLines(value: string): readonly string[] {
  return value
    .normalize('NFKC')
    .split(/\r?\n/u)
    .map(normalizedBoundaryLine)
    .filter(Boolean)
}

type BoundaryRange = Readonly<{ start: number; end: number }>

function matchingBoundaryRange(
  body: string,
  candidate: string,
  edge: 'leading' | 'trailing',
): BoundaryRange | null {
  const rawLines = body.normalize('NFKC').split(/\r?\n/u)
  const lines = rawLines
    .map((line, index) => ({ index, value: normalizedBoundaryLine(line) }))
    .filter((line) => line.value.length > 0)
  const candidateValue = boundaryLines(candidate).join(' ')
  if (!candidateValue || lines.length === 0) return null

  let boundaryValue = ''
  for (let count = 1; count <= lines.length; count += 1) {
    const line = edge === 'leading' ? lines[count - 1]! : lines[lines.length - count]!
    boundaryValue =
      edge === 'leading'
        ? `${boundaryValue}${boundaryValue ? ' ' : ''}${line.value}`
        : `${line.value}${boundaryValue ? ' ' : ''}${boundaryValue}`
    if (boundaryValue === candidateValue) {
      return edge === 'leading'
        ? { start: 0, end: line.index }
        : { start: line.index, end: rawLines.length - 1 }
    }
    if (boundaryValue.length >= candidateValue.length) return null
  }
  return null
}

function matchesBoundary(
  body: string,
  candidate: string,
  edge: 'leading' | 'trailing',
): boolean {
  return matchingBoundaryRange(body, candidate, edge) !== null
}

function withoutBoundary(
  body: string,
  candidate: string,
  edge: 'leading' | 'trailing',
): string | null {
  const range = matchingBoundaryRange(body, candidate, edge)
  if (range === null) return null
  const lines = body.split(/\r?\n/u)
  lines.splice(range.start, range.end - range.start + 1)
  return lines.join('\n').trim()
}

function hasGreetingLine(body: string, greeting: string): boolean {
  const [firstLine = ''] = boundaryLines(body)
  return matchesBoundary(body, greeting, 'leading') || GREETING_LINE.test(firstLine)
}

function hasProfileSignOff(body: string, profile: ReplyTemplateRenderProfile): boolean {
  // Imported workbooks commonly carry a profile sign-off with different blank
  // lines, casing, or punctuation. Compare complete trailing lines after
  // normalizing those presentation details, and accept either rating band's
  // sign-off so loading a template never duplicates or replaces its closing.
  return [profile.signOffPositive, profile.signOffNegative].some((signOff) =>
    matchesBoundary(body, signOff, 'trailing'),
  )
}

/**
 * Remove property-specific boundary copy before a template becomes provider
 * style material. The same normalization used by local rendering decides what
 * constitutes an existing greeting or sign-off.
 */
export function stripReplyTemplateProfileFraming(
  body: string,
  profile: ReplyTemplateRenderProfile,
): string {
  let stripped = body.trim()
  const withoutConfiguredGreeting = withoutBoundary(stripped, profile.greeting, 'leading')
  if (withoutConfiguredGreeting !== null) {
    stripped = withoutConfiguredGreeting
  } else {
    const lines = stripped.split(/\r?\n/u)
    const firstContentLine = lines.findIndex(
      (line) => normalizedBoundaryLine(line).length > 0,
    )
    if (
      firstContentLine >= 0 &&
      GREETING_LINE.test(normalizedBoundaryLine(lines[firstContentLine]!))
    ) {
      lines.splice(0, firstContentLine + 1)
      stripped = lines.join('\n').trim()
    }
  }

  for (const signOff of [profile.signOffPositive, profile.signOffNegative]) {
    const withoutSignOff = withoutBoundary(stripped, signOff, 'trailing')
    if (withoutSignOff !== null) {
      stripped = withoutSignOff
      break
    }
  }
  return stripped
}

export function applyReplyTemplateEmojiPolicy(
  body: string,
  emojiAllowed: boolean,
): string {
  if (emojiAllowed) return body.trim()
  return body
    .replace(EMOJI, '')
    .replaceAll(/[ \t]+(?=\r?\n|$)/g, '')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim()
}

export function renderReplyTemplate(
  template: ReplyTemplateRenderTemplate,
  profile: ReplyTemplateRenderProfile | null,
  rating: number,
): string {
  let rendered = template.body.trim()
  if (profile === null) return rendered
  if (profile.escalationContact !== null) {
    rendered = rendered.replaceAll('{escalation_contact}', profile.escalationContact)
  }
  if (profile.greeting.trim() && !hasGreetingLine(rendered, profile.greeting)) {
    rendered = `${profile.greeting.trim()}\n\n${rendered}`
  }
  const signOff =
    rating >= 4 ? profile.signOffPositive.trim() : profile.signOffNegative.trim()
  if (signOff && !hasProfileSignOff(rendered, profile)) {
    rendered = `${rendered.trimEnd()}\n\n${signOff}`
  }
  rendered = applyReplyTemplateEmojiPolicy(rendered, profile.emojiAllowed)
  return rendered
}
