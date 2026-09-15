// Story-only doubles for the "Set up properties" step. Not a story file: the
// Storybook glob matches only a final `.stories.` segment, and the import
// progress stories share these with the step's own stories.
import { fn } from 'storybook/test'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { PropertySetupFns, SetupMember } from './property-setup-contract'

export const STORY_ADMIN: SetupMember = {
  userId: 'user-admin',
  name: 'Mira Admin',
  email: 'mira@example.com',
}
export const STORY_MANAGER: SetupMember = {
  userId: 'user-manager',
  name: 'Theo Manager',
  email: 'theo@example.com',
}

export type StorySetupProperty = Readonly<{
  propertyId: string
  name: string
  /** Undefined starts with the automatic name, the property's own; null has none. */
  publicDisplayName?: string | null
  /** A person saved the public display name, so the step does not ask it. */
  publicDisplayNameConfirmed?: boolean
  countryCode: string | null
  defaultReplyLanguage?: string | null
  aiEnabled?: boolean
  managerIds?: readonly string[]
  eligibleManagerIds?: readonly string[]
}>

type Options = Readonly<{
  properties: readonly StorySetupProperty[]
  /** Property ids whose reply language write fails. */
  failLanguageFor?: readonly string[]
}>

type Spied<T> = { [K in keyof T]: T[K] & ReturnType<typeof fn> }

/** Server-function doubles over one in-memory organization. */
export function createSetupFnsFixture(options: Options): Spied<PropertySetupFns> {
  const properties = new Map(
    options.properties.map((property) => [property.propertyId, { ...property }]),
  )
  const failingLanguage = new Set(options.failLanguageFor ?? [])
  let failuresLeft = failingLanguage.size

  const fixture = {
    listProperties: fn(async () => ({
      properties: [...properties.values()].map((property) => ({
        id: property.propertyId,
        name: property.name,
        countryCode: property.countryCode,
        defaultReplyLanguage: property.defaultReplyLanguage ?? null,
      })),
    })),
    listMembers: fn(async () => ({
      members: [STORY_ADMIN, STORY_MANAGER].map((member, index) => ({
        id: `member-${index}`,
        userId: member.userId,
        role: index === 0 ? 'AccountAdmin' : 'PropertyManager',
        rawRole: index === 0 ? 'owner' : 'member',
        email: member.email,
        name: member.name,
        image: null,
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      })),
      requestingRole: 'AccountAdmin',
    })),
    listPropertyResponsibleManagers: fn(
      async ({ data }: { data: { propertyId: string } }) => {
        const property = properties.get(data.propertyId)
        return {
          assignments: (property?.managerIds ?? []).map((userId) => ({ userId })),
          eligibleManagers: (
            property?.eligibleManagerIds ?? [STORY_ADMIN.userId, STORY_MANAGER.userId]
          ).map((userId) => ({ userId })),
          revision: 1,
          responsibilityNeeded: (property?.managerIds ?? []).length === 0,
          responsibilityNeededSince: null,
        }
      },
    ),
    listMerchantAiOverview: fn(async () => ({
      properties: [...properties.values()].map((property) => ({
        propertyId: property.propertyId,
        propertyName: property.name,
        state: property.aiEnabled ? 'enabled' : 'disabled',
        capabilities: property.aiEnabled ? ['review_analysis'] : [],
        noticeVersion: property.aiEnabled ? MERCHANT_AI_NOTICE.version : null,
        reconsentRequired: false,
        decisionDeferredAt: null,
        googleBindingActive: true,
      })),
    })),
    getMerchantAiAuthorization: fn(async () => ({
      authorization: null,
      notice: MERCHANT_AI_NOTICE,
    })),
    getReviewAnalysisProgress: fn(async () => ({
      status: 'analysing',
      queued: 82,
      inProgress: 2,
      analysed: 12,
      notAnalysable: 0,
      verifiedThroughEpochMillis: null,
    })),
    getPropertyPortalExperience: fn(
      async ({ data }: { data: { propertyId: string } }) => {
        const property = properties.get(data.propertyId)
        const displayName =
          property?.publicDisplayName === undefined
            ? (property?.name ?? null)
            : property.publicDisplayName
        const confirmed = displayName !== null && property?.publicDisplayNameConfirmed
        return {
          profile:
            displayName === null
              ? null
              : {
                  id: `brand-${data.propertyId}`,
                  organizationId: 'org-story',
                  propertyId: data.propertyId,
                  displayName,
                  logoUrl: null,
                  defaultHeroImageUrl: null,
                  primaryColor: '#2563EB',
                  backgroundColor: '#FFFFFF',
                  textColor: '#111827',
                  version: 1,
                  updatedBy: confirmed
                    ? STORY_ADMIN.userId
                    : 'system:public-display-name-default',
                  createdAt: new Date('2026-09-15T08:00:00.000Z'),
                  updatedAt: new Date('2026-09-15T08:00:00.000Z'),
                },
          content: [],
          overrides: [],
          canManagePropertyBrand: true,
          publicDisplayNameConfirmed: confirmed === true,
        }
      },
    ),
    savePropertyPublicDisplayName: fn(
      async ({ data }: { data: { propertyId: string; displayName: string } }) => {
        const property = properties.get(data.propertyId)
        if (property) {
          properties.set(data.propertyId, {
            ...property,
            publicDisplayName: data.displayName,
            publicDisplayNameConfirmed: true,
          })
        }
        return { id: `brand-${data.propertyId}`, displayName: data.displayName }
      },
    ),
    updateProperty: fn(
      async ({
        data,
      }: {
        data: { propertyId: string; defaultReplyLanguage: string }
      }) => {
        if (failingLanguage.has(data.propertyId) && failuresLeft > 0) {
          failuresLeft -= 1
          throw new Error('The property could not be reached. Try again.')
        }
        const property = properties.get(data.propertyId)
        if (property) {
          properties.set(data.propertyId, {
            ...property,
            defaultReplyLanguage: data.defaultReplyLanguage,
          })
        }
        return { property: { id: data.propertyId } }
      },
    ),
    updatePropertyResponsibleManagers: fn(
      async ({ data }: { data: { propertyId: string; managerUserIds: string[] } }) => {
        const property = properties.get(data.propertyId)
        if (property) {
          properties.set(data.propertyId, {
            ...property,
            managerIds: data.managerUserIds,
          })
        }
        return { revision: 2 }
      },
    ),
    enableMerchantAiForProperties: fn(
      async ({ data }: { data: { propertyIds: string[] } }) => {
        for (const propertyId of data.propertyIds) {
          const property = properties.get(propertyId)
          if (property) properties.set(propertyId, { ...property, aiEnabled: true })
        }
        return []
      },
    ),
    deferMerchantAiDecision: fn(async ({ data }: { data: { propertyId: string } }) => ({
      propertyId: data.propertyId,
      decisionDeferredAt: '2026-09-15T08:00:00.000Z',
    })),
  }
  return fixture as unknown as Spied<PropertySetupFns>
}
