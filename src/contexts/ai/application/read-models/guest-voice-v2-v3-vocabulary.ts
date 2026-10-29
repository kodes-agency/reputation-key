// The v3 review-analysis vocabulary the Guest voice 2.0 read model speaks in.
//
// PR-3 owns it (`src/shared/review-analysis-v3.ts`, contract section 1.1). This file
// is a stand-in with the same names and the same members, here so the Guest voice 2.0
// page can be built and shown on fixtures before PR-3 lands. When PR-3 is rebased in,
// delete this file and import the two types from `#/shared/review-analysis-v3`; nothing
// else changes. Only the types this page reads are copied.

/** The twelve topics every kind of business shares (annotation guide v3, "The 12 topics"). */
export type ReviewTopicV3 =
  | 'staff_service'
  | 'speed_waiting'
  | 'booking_arrival'
  | 'main_service'
  | 'food_drink'
  | 'cleanliness'
  | 'facilities_equipment'
  | 'price_billing'
  | 'atmosphere_noise'
  | 'location_access'
  | 'safety'
  | 'communication'

/** Why a review is Urgent: the four reasons of the guide, and no others. */
export type UrgentReasonV3 = 'safety' | 'health' | 'discrimination' | 'legal_threat'
