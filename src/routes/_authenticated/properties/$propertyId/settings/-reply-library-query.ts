import { queryOptions } from '@tanstack/react-query'
import { reviewKeys } from '#/shared/queries/query-keys'

export const propertyReplyLibraryQuery = (propertyId: string) =>
  queryOptions({
    queryKey: reviewKeys.replyLibrary(propertyId),
    queryFn: async () =>
      (await import('#/contexts/review/server/reply-library')).getReplyLibraryFn({
        data: { propertyId },
      }),
    staleTime: 30_000,
  })
