/** Browser-safe contracts for Portal management screens; calls stay in server/. */
export { isValidLinkDestination } from '../domain/rules'
/** Whether the Property wrote wording for a language: the base a Portal's own lines need. */
export { hasPropertyWording } from '../domain/property-wording'
export type { Portal } from '../domain/types'
/** C2: portal token existence/metadata for management surfaces — never token material. */
export type { PortalTokenStatus } from './portal-token-status'
export type { PortalOverviewRow } from './use-cases/list-portal-overview'
export type { PortalPublicationHistory } from './use-cases/get-portal-publication-history'
export type {
  PortalLinktreeDestination,
  PortalLinktreeDestinationState,
  PortalLinktreeLink,
  PortalLinktreeView,
} from '../domain/portal-linktree-view'
export type {
  PropertyLookHero,
  PropertyLookLogo,
  PropertyLookMedia,
} from './property-look-media'
export type {
  PortalPreview,
  PortalPreviewExperience,
  PortalPreviewLink,
  PortalPreviewLinkState,
  PortalPreviewOrigin,
  PortalPreviewOutcome,
  PortalPreviewSource,
  PortalPreviewUnavailableReason,
} from './portal-preview'
export type { PortalHistoryEntry } from './use-cases/get-portal-history'
export type { PortalVersionItem, PortalVersions } from './use-cases/get-portal-versions'
export type { PortalVersionDetail } from './use-cases/get-portal-version'
export type {
  PortalPrintKitLastPrint,
  PortalPrintKitView,
} from './portal-print-kit-context'
export type { PrintSavedWording } from '#/shared/domain/portal-print-wording'
export type { PortalReview, PortalReviewChange } from './use-cases/get-portal-review'
export type { PublishPortalsChangesResult } from './use-cases/publish-portal-changes'
export type { ReviewCheck, ReviewLanguageRow } from '../domain/portal-review-rules'
export type {
  PublicationContentChange,
  PublicationLookFacet,
  PublicationWordingField,
} from '../domain/portal-publication-content'
export type {
  MissingPortalText,
  PortalLanguageCoverage,
  PortalLanguageCoverageRow,
} from '../domain/portal-language-coverage'
export type { PortalGroupHistoryEntry } from '../domain/portal-group-history'
export type { PortalHistoryDetail } from '../domain/portal-history'
export type {
  PortalPageEditKind,
  PortalPageEditSubject,
} from '../domain/portal-page-edit'
/** A Portal's own look (ADR 0070): where each group comes from, and whether a Property change reaches it. */
export { PROPERTY_LOOK_SOURCES, facetReachesPortal } from '../domain/portal-look'
export type { PortalLookSources } from '../domain/portal-look'
export type {
  PortalLookColoursInput,
  PortalLookColoursView,
  PortalLookIdentityInput,
  PortalLookIdentityView,
  PortalLookPhotoInput,
  PortalLookPhotoView,
  PortalLookSaved,
  PortalLookSettings,
  PortalLookView,
} from './dto/portal-look.dto'
