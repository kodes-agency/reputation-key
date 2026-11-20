import { z } from 'zod/v4'

export const requestPasswordResetFormSchema = z.object({
  email: z.email('A valid email address is required'),
})

export const setNewPasswordFormSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type RequestPasswordResetFormInput = z.infer<typeof requestPasswordResetFormSchema>
export type SetNewPasswordFormInput = z.infer<typeof setNewPasswordFormSchema>
