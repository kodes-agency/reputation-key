// The one place a Resend client is built. Identity mail (`shared/auth/emails`)
// and notification mail (the Feed adapter) both go through it, so the sandbox
// base URL and the API key are honoured the same way for both. Kept out of the
// `#/shared/email` barrel so the templates stay free of the SDK.
import { Resend } from 'resend'

export type ResendTransportConfig = Readonly<{
  apiKey: string
  /** RESEND_BASE_URL: absent → the SDK default (https://api.resend.com). */
  baseUrl?: string | undefined
}>

export const createResendTransport = (config: ResendTransportConfig): Resend =>
  config.baseUrl
    ? new Resend(config.apiKey, { baseUrl: config.baseUrl })
    : new Resend(config.apiKey)
