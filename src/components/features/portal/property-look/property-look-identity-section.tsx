// Name and logo (board 09): what guests see at the top of every page. The
// display name belongs to property settings (AI reply drafts read it), so it is
// shown here and changed there; the wordmark is the look's own. The logo is
// uploaded here and replaces the wordmark on guest pages once one exists.
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { FieldOptional } from '#/components/ui/field'
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

const WORDMARK_HINT = 'Top left of every page, until you add a logo'

export function PropertyLookIdentitySection({
  propertyId,
  displayName,
  wordmark,
  onWordmarkChange,
  disabled,
  logo,
}: Props) {
  const tooLong = wordmark.trim().length > WORDMARK_MAX
  // The reason takes the hint's place, and the control names whichever is showing.
  const hint = tooLong ? undefined : WORDMARK_HINT
  return (
    <PropertyLookSection
      title="Name and logo"
      hint="Guests see it at the top of every page."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <DescriptionList stacked aria-label="Display name">
          <DescriptionItem
            term="Display name"
            note={
              <>
                From{' '}
                <InlineLink
                  to="/properties/$propertyId/settings/profile"
                  params={{ propertyId }}
                >
                  property settings
                </InlineLink>
              </>
            }
          >
            {displayName}
          </DescriptionItem>
        </DescriptionList>
        <FormFieldFrame
          id="property-look-wordmark"
          label="Wordmark"
          description={hint}
          invalid={tooLong}
          errors={
            tooLong ? [{ message: `At most ${WORDMARK_MAX} characters` }] : undefined
          }
          className="gap-1.5"
        >
          <Input
            id="property-look-wordmark"
            value={wordmark}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={tooLong}
            aria-describedby={describedByOf('property-look-wordmark', hint, tooLong)}
            className="uppercase tracking-[0.2em]"
            onChange={(event) => onWordmarkChange(event.target.value)}
          />
        </FormFieldFrame>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Logo
          <FieldOptional />
        </p>
        <PropertyLookLogoField logo={logo} />
      </div>
    </PropertyLookSection>
  )
}
