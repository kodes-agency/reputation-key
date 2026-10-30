import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  LocalizedReplyVoiceOverride,
  ReplyVoiceField,
  ReplyVoiceOverride,
  ReplyVoiceSettings,
} from '#/shared/reply-library/reply-voice'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { ReplyLibraryRef, ReplyLibraryScope } from '../dto/reply-library.dto'
import type { Tx } from '#/shared/outbox/commit'

export type StoredReplyVoice = ReplyVoiceOverride &
  Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId | null
    version: number
  }>

export type StoredReplyTemplateWording = Readonly<{
  key: string
  languageGroup: string
  body: string
}>

export type StoredReplyTemplate = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId | null
  builtinKey: string | null
  basedOnTemplateId: string | null
  basedOnBuiltinVersion: number | null
  revisionId: string
  revision: number
  revisionCreatedAt: Date
  title: string
  starsMin: number
  starsMax: number
  reviewKind: 'text' | 'rating_only'
  topic: ReviewTopicV3 | null
  wordings: readonly StoredReplyTemplateWording[]
}>

export type StoredReplyTemplateVisibility = Readonly<{
  propertyId: PropertyId | null
  ref: ReplyLibraryRef
}>

export type ReplyLibrarySnapshot = Readonly<{
  propertyName: string
  defaultReplyLanguage: string | null
  accountVoice: StoredReplyVoice | null
  propertyVoice: StoredReplyVoice | null
  accountTemplates: readonly StoredReplyTemplate[]
  propertyTemplates: readonly StoredReplyTemplate[]
  visibility: readonly StoredReplyTemplateVisibility[]
}>

export type SaveReplyVoiceRecord = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  scope: ReplyLibraryScope
  set: Partial<ReplyVoiceSettings>
  reset: readonly ReplyVoiceField[]
  localized?: Partial<Record<string, LocalizedReplyVoiceOverride>>
  expectedVersion: number
  actorId: string
}>

export type SaveReplyTemplateRecord = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  scope: ReplyLibraryScope
  base?: ReplyLibraryRef
  templateId?: string
  title: string
  starsMin: number
  starsMax: number
  reviewKind: 'text' | 'rating_only'
  topic: ReviewTopicV3 | null
  wordings: readonly StoredReplyTemplateWording[]
  expectedVersion?: number
  actorId: string
}>

export type ReplyLibraryRepository = Readonly<{
  loadSnapshot(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<ReplyLibrarySnapshot | null>
  loadVoiceOverridesForShare?(
    tx: Tx,
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<Readonly<{
    accountVoice: StoredReplyVoice | null
    propertyVoice: StoredReplyVoice | null
  }> | null>
  saveVoice(input: SaveReplyVoiceRecord): Promise<StoredReplyVoice | 'version_conflict'>
  saveTemplate(
    input: SaveReplyTemplateRecord,
  ): Promise<StoredReplyTemplate | 'base_unavailable' | 'version_conflict'>
  setHidden(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    scope: ReplyLibraryScope
    ref: ReplyLibraryRef
    hidden: boolean
    actorId: string
  }): Promise<void>
  archiveCustomization(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    scope: ReplyLibraryScope
    ref: ReplyLibraryRef
    actorId: string
  }): Promise<boolean>
  findPublishedUsage?(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    templateRef?: string
  }): Promise<
    readonly Readonly<{
      wordingKey: string | null
      publishedAt: Date
      voiceChoices: Readonly<{
        closing: number
        signOff: number
        contactSentence: number
        emoji: number
        includeContact: boolean
      }> | null
    }>[]
  >
  findRecentLiveReplyTexts?(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    excludeReviewId: string
    limit: number
  }): Promise<readonly string[]>
}>
