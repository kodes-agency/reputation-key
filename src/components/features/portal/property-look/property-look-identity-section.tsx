// Name and logo (board 09): what guests see at the top of every page. The
// display name belongs to Property settings (AI reply drafts read it), so it is
// shown here and changed there; the wordmark is the look's own. The logo's
// upload control mounts in `logoSlot` (slice 42c2) and replaces the wordmark on
// guest pages once a logo exists.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Input } from '#/components/ui/input'
import { PropertyLookSection } from './property-look-section'
import { WORDMARK_MAX } from './property-look-rules'

type Props = Readonly<{
  propertyId: string
  displayName: string
  wordmark: string
  onWordmarkChange: (wordmark: string) => void
  disabled: boolean
  logoSlot?: ReactNode
}>

const WORDMARK_HINT_ID = 'property-look-wordmark-hint'

export function PropertyLookIdentitySection({
  propertyId,
  displayName,
  wordmark,
  onWordmarkChange,
  disabled,
  logoSlot = null,
}: Props) {
  const tooLong = wordmark.trim().length > WORDMARK_MAX
  return (
    <PropertyLookSection
      title="Name and logo"
      hint="Guests see it at the top of every page."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Display name</p>
          <p className="text-sm">{displayName}</p>
          <p className="text-sm text-muted-foreground">
            From{' '}
            <Link
              to="/properties/$propertyId/settings/profile"
              params={{ propertyId }}
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              Property settings
            </Link>
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="property-look-wordmark" className="text-sm font-medium">
            Wordmark
          </label>
          <Input
            id="property-look-wordmark"
            value={wordmark}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={tooLong}
            aria-describedby={WORDMARK_HINT_ID}
            className="uppercase tracking-[0.2em]"
            onChange={(event) => onWordmarkChange(event.target.value)}
          />
          <p
            id={WORDMARK_HINT_ID}
            className={
              tooLong ? 'text-sm text-negative' : 'text-sm text-muted-foreground'
            }
          >
            {tooLong
              ? `At most ${WORDMARK_MAX} characters`
              : 'Top left of every page, until you add a logo'}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Logo <span className="font-normal text-muted-foreground">optional</span>
        </p>
        {logoSlot ?? (
          <p className="text-sm text-muted-foreground">
            A light logo on a transparent background (SVG or PNG). It replaces the
            wordmark on every page and on printed codes.
          </p>
        )}
      </div>
    </PropertyLookSection>
  )
}
