// The Print kit section while nothing is live: one notice in place of the section
// and its preview, since a print carries the code of the live page and a retry
// cannot make one. It says what to do first, and where.

import { buttonVariants } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import type { PrintKitNotLiveNotice } from './print-kit-state'

export function PortalPrintKitNotLive({
  notice,
}: Readonly<{ notice: PrintKitNotLiveNotice | null }>) {
  if (notice === null) return null
  return (
    <section className="flex flex-col gap-1" aria-labelledby="print-kit-heading">
      <h2 id="print-kit-heading" className="text-lg font-semibold">
        Print kit
      </h2>
      <p className="text-sm text-muted-foreground">
        {notice.body}
        {notice.review === null ? null : (
          <>
            {' '}
            <InlineLink
              to="/properties/$propertyId/portals/$portalId/review"
              params={notice.review}
              search={{ tab: 'share' }}
              underline="always"
              // A tap target on a phone; the sentence's own line on a desktop.
              className={buttonVariants({ variant: 'link', size: 'inline', touch: true })}
            >
              Review &amp; publish
            </InlineLink>
          </>
        )}
      </p>
    </section>
  )
}
