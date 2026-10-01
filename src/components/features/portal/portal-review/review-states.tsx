// "See every guest state": the guest page at each step (arrival, after each
// rating, done) as small pictures. Choosing one shows it in the phone on the
// right; the pair returns when the manager asks for it again.

import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { Button } from '#/components/ui/button'
import { PortalPreviewFilmstrip } from '../portal-preview/portal-preview-filmstrip'
import {
  previewStateOptions,
  type PreviewStateId,
} from '../portal-preview/portal-preview-states'
import { PreviewGuestPage } from '../portal-preview/preview-guest-page'
import { describeStatesSummary } from './portal-review-languages'
import type { ReviewPreviewView } from './review-preview'
import type { ReviewPreviewData } from './use-review-preview'

type Props = Readonly<{
  data: ReviewPreviewData
  view: ReviewPreviewView
  onViewChange: (view: ReviewPreviewView) => void
  languageCount: number
}>

export function ReviewStates({ data, view, onViewChange, languageCount }: Props) {
  if (data.status !== 'ready') return null
  const { preview, experience, copy, locale } = data
  const options = previewStateOptions(preview.privateFeedbackThreshold)
  const active = view.kind === 'state' ? view.id : null
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="group h-auto w-full justify-start gap-3 px-1 py-3 text-left font-normal"
        >
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
          />
          <span className="font-medium">See every guest state</span>
          <span className="min-w-0 whitespace-normal text-xs text-muted-foreground">
            {describeStatesSummary(languageCount)}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <PortalPreviewFilmstrip
          options={options}
          layout="row"
          active={active}
          onSelect={(id: PreviewStateId) => {
            const chosen = options.find((option) => option.id === id)
            if (chosen !== undefined) {
              onViewChange({
                kind: 'state',
                id: chosen.id,
                label: chosen.label,
                state: chosen.state,
              })
            }
          }}
          renderPage={(state) => (
            <PreviewGuestPage
              experience={experience}
              copy={copy}
              locale={locale}
              hasLanguageChip={preview.locales.length > 1}
              state={state}
            />
          )}
        />
        {view.kind === 'pair' ? null : (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-1"
            onClick={() => onViewChange({ kind: 'pair' })}
          >
            Back to the 1★ and 5★ pair
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
