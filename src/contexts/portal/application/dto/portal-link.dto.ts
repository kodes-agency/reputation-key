// Portal context — link DTOs

import { z } from 'zod/v4'

export const createLinkInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  portalId: z.string().min(1, 'Portal ID is required'),
  label: z.string().min(1, 'Label is required').max(100),
  url: z.string().min(1, 'URL is required').max(500),
  iconKey: z.string().max(50).optional(),
})

// CreateLinkInput — exported when consumed by route validators or forms
export const updateLinkInputSchema = z.object({
  linkId: z.string().min(1, 'Link ID is required'),
  label: z.string().min(1).max(100).optional(),
  url: z.string().min(1).max(500).optional(),
  iconKey: z.string().max(50).nullable().optional(),
})

// UpdateLinkInput — exported when consumed by route validators or forms
export const reorderLinksInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  portalId: z.string().min(1, 'Portal ID is required'),
  items: z.array(
    z.object({
      id: z.string().min(1),
      sortKey: z.string().min(1),
    }),
  ),
})

// ReorderLinksInput — exported when consumed by route validators or forms
