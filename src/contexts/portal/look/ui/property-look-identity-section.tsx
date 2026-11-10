// Name and logo (board 09): what guests see at the top of every page. The
// display name belongs to property settings (AI reply drafts read it), so it is
// shown here and changed there; the wordmark is the look's own. The logo is
// uploaded here and replaces the wordmark on guest pages once one exists.
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { FieldOptional } from '#/components/ui/field'
import {
  PropertyLookLogoField,
  type PropertyLookLogoControls,
} from './property-look-logo-field'
import { PropertyLookSection } from './property-look-section'
import { PropertyLookWordmarkField } from './property-look-wordmark-field'
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
        <PropertyLookWordmarkField
          id="property-look-wordmark"
          value={wordmark}
          onChange={onWordmarkChange}
          disabled={disabled}
          hint={WORDMARK_HINT}
        />
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
