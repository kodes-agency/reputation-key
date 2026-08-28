// Portal context — link category DTOs

import { z } from 'zod/v4'

export const portalLinkCategoryTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(100)

export const createLinkCategoryInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  title: portalLinkCategoryTitleSchema,
})

// CreateLinkCategoryInput — exported when consumed by route validators or forms
export const updateLinkCategoryInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  title: portalLinkCategoryTitleSchema.optional(),
})

// UpdateLinkCategoryInput — exported when consumed by route validators or forms
export const reorderCategoriesInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  items: z.array(
    z.object({
      id: z.string().min(1),
      sortKey: z.string().min(1),
    }),
  ),
})

// ReorderCategoriesInput — exported when consumed by route validators or forms
