// Name and logo (board 09): what guests see at the top of every page. The
// display name belongs to Property settings (AI reply drafts read it), so it is
// shown here and changed there; the wordmark is the look's own. The logo is
// uploaded here and replaces the wordmark on guest pages once one exists.
import { Input } from '#/components/ui/input'
import {
  PropertyLookLogoField,
  type PropertyLookLogoControls,
} from './property-look-logo-field'
import { PropertyLookSection } from './property-look-section'
import { WORDMARK_MAX } from './property-look-rules'
import { InlineLink } from '#/components/ui/inline-link'

type Props = Readonly<{
  propertyId: string
  displayName: string
  wordmark: string
  onWordmarkChange: (wordmark: string) => void
  disabled: boolean
  logo: PropertyLookLogoControls
}>

const WORDMARK_HINT_ID = 'property-look-wordmark-hint'

export function PropertyLookIdentitySection({
  propertyId,
  displayName,
  wordmark,
  onWordmarkChange,
  disabled,
  logo,
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
            <InlineLink
              to="/properties/$propertyId/settings/profile"
              params={{ propertyId }}
            >
              Property settings
            </InlineLink>
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
        <PropertyLookLogoField logo={logo} />
      </div>
    </PropertyLookSection>
  )
}
