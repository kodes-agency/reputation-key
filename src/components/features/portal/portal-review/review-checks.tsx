// "Checks": what stops the publication (blocked), what deserves a note
// (warnings) and, folded into one line, what passed. A blocked check is one the
// server would refuse the publication on, so each says what to do and who can
// do it; a warning says what guests read instead and that publishing can go on.

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { TONE_ICON, TONE_INK, TONE_SURFACE } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type {
  PortalReview,
  ReviewLanguageRow,
} from '#/contexts/portal/application/public-api'
import { PhraseView } from '../portal-history/portal-phrase-view'
import {
  describeFixLink,
  describeFixerLine,
  describeReviewCheck,
  reviewCheckContext,
  summarizePassedChecks,
  type ReviewCheckLine,
} from './portal-review-checks'

type Props = Readonly<{
  checks: PortalReview['checks']
  languages: readonly ReviewLanguageRow[]
  propertyId: string
  portalId: string
  /** "you or Georgi Ivanov"; null when no one is known. */
  whoCanFix: string | null
}>

export function ReviewChecks({
  checks,
  languages,
  propertyId,
  portalId,
  whoCanFix,
}: Props) {
  const lines = checks.map((check) =>
    describeReviewCheck(check, reviewCheckContext(languages, check.locale)),
  )
  const findings = lines.filter((line) => line.status !== 'passed')
  const passed = lines.filter((line) => line.status === 'passed')
  return (
    <section aria-labelledby="review-checks-heading" className="space-y-3">
      <h2 id="review-checks-heading" className="text-lg font-semibold">
        Checks
      </h2>
      {findings.length === 0 ? null : (
        <ul className="space-y-3">
          {findings.map((line) => (
            <Finding
              key={line.id}
              line={line}
              propertyId={propertyId}
              portalId={portalId}
              whoCanFix={whoCanFix}
            />
          ))}
        </ul>
      )}
      <PassedChecks passed={passed} />
    </section>
  )
}

function Finding({
  line,
  propertyId,
  portalId,
  whoCanFix,
}: Readonly<{
  line: ReviewCheckLine
  propertyId: string
  portalId: string
  whoCanFix: string | null
}>) {
  const isBlocked = line.status === 'blocked'
  // A blocked check is a failure, a warning is a caution: the tone table draws
  // each with its own tint, ink and icon, as Alert and Badge do.
  const tone = isBlocked ? 'negative' : 'warn'
  const Icon = TONE_ICON[tone]
  const fix = line.fix === null ? null : describeFixLink(line.fix)
  const fixerLine = describeFixerLine(line.fixer, whoCanFix)
  return (
    <li
      className={cn('flex items-start gap-3 rounded-md border p-3', TONE_SURFACE[tone])}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', TONE_INK[tone])} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium">
          <span className="sr-only">
            {isBlocked ? 'Stops publishing: ' : 'Warning: '}
          </span>
          <PhraseView phrase={line.title} />
        </p>
        {line.detail === null ? null : (
          <p className="text-muted-foreground">
            <PhraseView phrase={line.detail} />
          </p>
        )}
        {line.note === null ? null : <p className="font-medium">{line.note}</p>}
        {fixerLine === null ? null : (
          <p className="text-xs text-muted-foreground">{fixerLine}</p>
        )}
      </div>
      {fix === null ? null : (
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId }}
            search={fix.search}
          >
            {fix.label}
          </Link>
        </Button>
      )}
    </li>
  )
}

function PassedChecks({ passed }: Readonly<{ passed: readonly ReviewCheckLine[] }>) {
  const [isOpen, setIsOpen] = useState(false)
  const summary = summarizePassedChecks(passed)
  if (summary === null) return null
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-3">
        <CircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <p className="min-w-0 flex-1 text-muted-foreground">{summary}</p>
        <Button
          type="button"
          variant="link"
          size="inline"
          aria-label={isOpen ? 'Hide passed checks' : 'Show passed checks'}
          aria-expanded={isOpen}
          aria-controls="review-passed-checks"
          onClick={() => setIsOpen((open) => !open)}
          className="px-1 py-1"
        >
          {isOpen ? 'Hide' : 'Show'}
        </Button>
      </div>
      {isOpen ? (
        <ul
          id="review-passed-checks"
          className="mt-2 space-y-1 pl-7 text-muted-foreground"
        >
          {passed.map((line) => (
            <li key={line.id}>
              <PhraseView phrase={line.title} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
