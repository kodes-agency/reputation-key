// The guest page of one published version, in the History's "View" dialog: the
// real page the preview draws (slice 47a), fed by a verified snapshot of the
// version chosen, in any of its languages and guest states. It is the editor
// preview's body and stage with no source switch and no "Try as guest": a past
// version is looked at, not played. Reads one server function and writes nothing.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import { portalKeys } from '#/shared/queries/query-keys'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import type { PortalPreviewOutcome } from '#/contexts/portal/application/public-api'
import { PortalPreviewBody } from '../portal-preview/portal-preview-pane'
import { usePreviewCopy } from '../portal-preview/use-preview-copy'
import type { PreviewStateId } from '../portal-preview/portal-preview-states'

/** The read, as the route hands it in (a server function takes its input as `data`). */
export type PortalVersionPreviewReader = (args: {
  data: { portalId: string; version: number }
}) => Promise<PortalPreviewOutcome>

type Props = Readonly<{
  portalId: string
  version: number
  getVersionPreview: PortalVersionPreviewReader
}>

/** Never "trying": the stage asks to leave that mode when a guest state is chosen. */
const never = () => undefined

export function PortalVersionPreview({ portalId, version, getVersionPreview }: Props) {
  const [chosenLocale, setChosenLocale] = useState<GuestLocale | null>(null)
  const [stateId, setStateId] = useState<PreviewStateId>('arrival')
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: portalKeys.versionPreview(portalId, version),
    queryFn: () => getVersionPreview({ data: { portalId, version } }),
    // Which addresses and images the page draws depends on what is approved now, so it is read afresh on each opening.
    staleTime: 0,
  })
  const preview = data?.status === 'ready' ? data.preview : null
  // The chosen language may not be one this version offers: fall back to its primary.
  const locale =
    chosenLocale !== null && preview?.locales.includes(chosenLocale)
      ? chosenLocale
      : (preview?.primaryLocale ?? 'en')
  const copy = usePreviewCopy(locale)

  return (
    <section
      aria-label={`Version ${version} as guests see it`}
      className="flex min-w-0 flex-col items-center gap-3"
    >
      {/* The guest fonts are linked here: the workspace is not a guest route. */}
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {preview !== null && preview.locales.length > 1 ? (
        <SegmentedControl
          aria-label="Preview language"
          value={locale}
          onValueChange={(value) => {
            const next = preview.locales.find((candidate) => candidate === value)
            if (next !== undefined) setChosenLocale(next)
          }}
          options={preview.locales.map((code) => ({
            value: code,
            label: GUEST_LOCALE_METADATA[code].chipLabel,
            accessibleLabel: GUEST_LOCALE_METADATA[code].englishName,
          }))}
        />
      ) : null}
      <PortalPreviewBody
        hasError={isError || copy.isError}
        isPending={isPending}
        data={data}
        copyData={copy.data}
        experience={preview?.experiences[locale]}
        onRetry={() => {
          if (isError) void refetch()
          if (copy.isError) void copy.refetch()
        }}
        locale={locale}
        stateId={stateId}
        onStateChange={setStateId}
        isTrying={false}
        onTryChange={never}
      />
    </section>
  )
}
