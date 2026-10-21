// The Review routes' input shapes: the strict zod schemas the route catalogue
// parses a descriptor with, and the matching TypeScript types. They live beside
// the catalogue, not in it, so the catalogue file does not grow with every
// Review route (it is on the file-length ratchet).

import { z } from 'zod/v4'
import { replyCommentProblem } from './reply-comment'

export const boundedRouteString = z.string().min(1).max(8_192)
export const optionalPageTokenSchema = z.string().min(1).max(2_048).optional()

/**
 * `reviews.list` ordering a caller may ask for. Google documents page 1 of a
 * list sorted `updateTime desc` as always accurate, which is what the head read
 * relies on. It is one literal, not a free string, so a descriptor can never
 * carry an arbitrary query value.
 */
export const REVIEW_LIST_NEWEST_UPDATED_FIRST = 'updateTime desc' as const

export const reviewRouteDescriptorSchemas = [
  z
    .object({
      routeKey: z.literal('reviews.list'),
      accessToken: boundedRouteString,
      locationName: z.string().min(1).max(1_024),
      pageToken: optionalPageTokenSchema,
      orderBy: z.literal(REVIEW_LIST_NEWEST_UPDATED_FIRST).optional(),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('reviews.get'),
      accessToken: boundedRouteString,
      reviewName: z.string().min(1).max(1_024),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('reviews.reply'),
      accessToken: boundedRouteString,
      reviewName: z.string().min(1).max(1_024),
      // Same rule as the compiled body: bytes, and line breaks allowed.
      comment: z.string().refine((comment) => replyCommentProblem(comment) === null),
    })
    .strict(),
] as const

export type ReviewRouteDescriptor =
  | Readonly<{
      routeKey: 'reviews.list'
      accessToken: string
      locationName: string
      pageToken?: string
      orderBy?: typeof REVIEW_LIST_NEWEST_UPDATED_FIRST
    }>
  | Readonly<{
      routeKey: 'reviews.get'
      accessToken: string
      reviewName: string
    }>
  | Readonly<{
      routeKey: 'reviews.reply'
      accessToken: string
      reviewName: string
      comment: string
    }>
