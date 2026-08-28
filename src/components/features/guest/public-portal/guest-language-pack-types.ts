/** Supported public Portal locales. */
export type GuestPortalLocale = 'en' | 'bg'
export type GuestPortalLanguagePackVersion = 'guest-ui-en-v1' | 'guest-ui-bg-v1'

export type GuestPortalCopy = Readonly<{
  locale: GuestPortalLocale
  version: GuestPortalLanguagePackVersion
  languageNavigationLabel: string
  portalLogoAlt: (organizationName: string) => string
  gatewayUnavailableTitle: string
  gatewayUnavailableBody: string
  previewRatingTitle: string
  previewRatingBody: string
  chooseRating: string
  ratingUpdated: string
  ratingSubmitted: string
  ratingSaveFailed: string
  feedbackRequired: string
  feedbackSent: string
  feedbackSaveFailed: string
  googleOpenFailed: string
  responseWithdrawFailed: string
  feedbackWithdrawnRatingSaved: string
  feedbackWithdrawFailed: string
  newResponseReady: string
  newResponseFailed: string
  responseWithdrawnTitle: string
  responseWithdrawnBody: string
  privateRatingLegend: string
  ratingGroupLabel: string
  ratingLabel: (rating: number) => string
  honeypotWebsite: string
  submitting: string
  submitPrivateRating: string
  privateRatingThanks: string
  ratedExperience: (rating: number) => string
  googleUnavailableTitle: string
  googleUnavailableBody: string
  googleTitle: string
  googleBody: string
  continueToGoogle: string
  privateFeedbackTitle: string
  privateFeedbackBody: string
  privateFeedbackLabel: string
  sending: string
  sendPrivateFeedback: string
  privateFeedbackReceipt: string
  privateFeedbackWithdrawalUntil: (deadline: string) => string
  withdrawPrivateFeedback: string
  privateFeedbackWindowEnded: string
  ratingCorrectionUntil: (deadline: string) => string
  saveRatingCorrection: string
  changePrivateRating: string
  responseWithdrawalWindowEnded: string
  responseWithdrawalUntil: (deadline: string) => string
  withdrawEntireResponse: string
  sharedDevicePrompt: string
  startNewResponse: string
  earlierResponseSaved: string
  moreLinksLabel: string
  moreFrom: (organizationName: string) => string
  moreDestinations: string
  analyticsLabel: string
  analyticsBody: string
  analyticsAcknowledge: string
}>
