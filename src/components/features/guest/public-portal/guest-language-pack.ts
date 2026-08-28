import type {
  GuestPortalCopy,
  GuestPortalLanguagePackVersion,
  GuestPortalLocale,
} from './guest-language-pack-types'

export type {
  GuestPortalCopy,
  GuestPortalLanguagePackVersion,
  GuestPortalLocale,
} from './guest-language-pack-types'

const formatDate = (value: string, locale: GuestPortalLocale): string =>
  new Date(value).toLocaleString(locale === 'bg' ? 'bg-BG' : 'en')

const EN: GuestPortalCopy = {
  locale: 'en',
  version: 'guest-ui-en-v1',
  languageNavigationLabel: 'Language',
  portalLogoAlt: (name) => `${name} logo`,
  gatewayUnavailableTitle: 'Review gateway temporarily unavailable',
  gatewayUnavailableBody: 'Please try again in a little while.',
  previewRatingTitle: 'How was your experience?',
  previewRatingBody:
    'Guests start with a private 1–5 star rating. Google follows after the rating, with private feedback offered when eligible.',
  chooseRating: 'Choose a rating from 1 to 5 stars.',
  ratingUpdated: 'Your private rating was updated.',
  ratingSubmitted: 'Thank you. Your private rating was submitted.',
  ratingSaveFailed: 'Your rating could not be saved. Please try again.',
  feedbackRequired: 'Write your private feedback before sending it.',
  feedbackSent: 'Your private feedback was sent to the property team.',
  feedbackSaveFailed: 'Your private feedback could not be sent. Please try again.',
  googleOpenFailed: 'The Google review link could not be opened. Please try again.',
  responseWithdrawFailed: 'Your response could not be withdrawn. Please try again.',
  feedbackWithdrawnRatingSaved:
    'Your private feedback was withdrawn. Your private rating remains saved.',
  feedbackWithdrawFailed:
    'Your private feedback could not be withdrawn. Please try again.',
  newResponseReady: 'Ready for another response. The earlier response remains saved.',
  newResponseFailed: 'A new response could not be started. Please try again.',
  responseWithdrawnTitle: 'Your response was withdrawn',
  responseWithdrawnBody: 'Its private rating and feedback were removed.',
  privateRatingLegend: 'Your private rating',
  ratingGroupLabel: 'Rating',
  ratingLabel: (rating) => `${rating} ${rating === 1 ? 'star' : 'stars'}`,
  honeypotWebsite: 'Website',
  submitting: 'Submitting…',
  submitPrivateRating: 'Submit private rating',
  privateRatingThanks: 'Thank you for your private rating',
  ratedExperience: (rating) => `You rated this experience ${rating}/5.`,
  googleUnavailableTitle: 'Google review link unavailable',
  googleUnavailableBody:
    'The Google review link isn’t available right now. Your private rating is saved, and you can continue with the options below.',
  googleTitle: 'Share your experience on Google',
  googleBody: 'If you would like, you can also leave a public Google review.',
  continueToGoogle: 'Continue to Google',
  privateFeedbackTitle: 'Share more with the property team',
  privateFeedbackBody:
    'This optional note is private. Sending it shares it with the managers responsible for this portal.',
  privateFeedbackLabel: 'Private feedback',
  sending: 'Sending…',
  sendPrivateFeedback: 'Send private feedback',
  privateFeedbackReceipt:
    'Your private feedback was sent to the property team. Its text is not shown again on this device.',
  privateFeedbackWithdrawalUntil: (deadline) =>
    `Private-feedback withdrawal is available until ${formatDate(deadline, 'en')}.`,
  withdrawPrivateFeedback: 'Withdraw only my private feedback',
  privateFeedbackWindowEnded: 'The private-feedback withdrawal window has ended.',
  ratingCorrectionUntil: (deadline) =>
    `Rating correction is available until ${formatDate(deadline, 'en')}.`,
  saveRatingCorrection: 'Save rating correction',
  changePrivateRating: 'Change your private rating',
  responseWithdrawalWindowEnded: 'The response withdrawal window has ended.',
  responseWithdrawalUntil: (deadline) =>
    `Complete response withdrawal is available until ${formatDate(deadline, 'en')}.`,
  withdrawEntireResponse: 'Withdraw my entire response',
  sharedDevicePrompt:
    'Using a shared device? You can clear this receipt for the next visitor.',
  startNewResponse: 'Start a new response',
  earlierResponseSaved: 'The response already submitted will remain saved.',
  moreLinksLabel: 'More links',
  moreFrom: (name) => `More from ${name}`,
  moreDestinations: 'More destinations',
  analyticsLabel: 'Portal analytics information',
  analyticsBody:
    'An essential session cookie protects your response. Separately, we count this visit using a short-lived, privacy-protected network marker. This helps the property understand how its review portal is performing and prevents duplicate activity.',
  analyticsAcknowledge: 'Got it',
}

const BG: GuestPortalCopy = {
  locale: 'bg',
  version: 'guest-ui-bg-v1',
  languageNavigationLabel: 'Език',
  portalLogoAlt: (name) => `Лого на ${name}`,
  gatewayUnavailableTitle: 'Порталът за отзиви временно не е достъпен',
  gatewayUnavailableBody: 'Моля, опитайте отново след малко.',
  previewRatingTitle: 'Как беше преживяването ви?',
  previewRatingBody:
    'Гостите започват с непублична оценка от 1 до 5 звезди. След оценката могат да продължат към Google, а при необходимост — да изпратят непублична обратна връзка.',
  chooseRating: 'Изберете оценка от 1 до 5 звезди.',
  ratingUpdated: 'Непубличната ви оценка беше променена.',
  ratingSubmitted: 'Благодарим ви. Непубличната ви оценка беше изпратена.',
  ratingSaveFailed: 'Оценката ви не можа да бъде запазена. Моля, опитайте отново.',
  feedbackRequired: 'Напишете обратната си връзка, преди да я изпратите.',
  feedbackSent: 'Непубличната ви обратна връзка беше изпратена до екипа на обекта.',
  feedbackSaveFailed:
    'Непубличната ви обратна връзка не можа да бъде изпратена. Моля, опитайте отново.',
  googleOpenFailed:
    'Връзката към Google не можа да бъде отворена. Моля, опитайте отново.',
  responseWithdrawFailed: 'Отговорът ви не можа да бъде оттеглен. Моля, опитайте отново.',
  feedbackWithdrawnRatingSaved:
    'Непубличната ви обратна връзка беше оттеглена. Оценката ви остава запазена.',
  feedbackWithdrawFailed:
    'Непубличната ви обратна връзка не можа да бъде оттеглена. Моля, опитайте отново.',
  newResponseReady: 'Можете да започнете нов отговор. Предишният остава запазен.',
  newResponseFailed: 'Не можа да бъде започнат нов отговор. Моля, опитайте отново.',
  responseWithdrawnTitle: 'Отговорът ви беше оттеглен',
  responseWithdrawnBody: 'Непубличната оценка и обратната връзка бяха премахнати.',
  privateRatingLegend: 'Вашата непублична оценка',
  ratingGroupLabel: 'Оценка',
  ratingLabel: (rating) => `${rating} ${rating === 1 ? 'звезда' : 'звезди'}`,
  honeypotWebsite: 'Уебсайт',
  submitting: 'Изпращане…',
  submitPrivateRating: 'Изпрати непубличната оценка',
  privateRatingThanks: 'Благодарим за непубличната ви оценка',
  ratedExperience: (rating) => `Оценихте преживяването си с ${rating}/5.`,
  googleUnavailableTitle: 'Връзката към Google не е достъпна',
  googleUnavailableBody:
    'Връзката към Google не е достъпна в момента. Непубличната ви оценка е запазена и можете да продължите с възможностите по-долу.',
  googleTitle: 'Споделете преживяването си в Google',
  googleBody: 'Ако желаете, можете да оставите и публичен отзив в Google.',
  continueToGoogle: 'Продължи към Google',
  privateFeedbackTitle: 'Споделете повече с екипа на обекта',
  privateFeedbackBody:
    'Тази бележка е по желание и не е публична. Тя ще бъде споделена само с мениджърите, отговорни за този портал.',
  privateFeedbackLabel: 'Непублична обратна връзка',
  sending: 'Изпращане…',
  sendPrivateFeedback: 'Изпрати обратната връзка',
  privateFeedbackReceipt:
    'Непубличната ви обратна връзка беше изпратена до екипа на обекта. Текстът ѝ няма да бъде показан отново на това устройство.',
  privateFeedbackWithdrawalUntil: (deadline) =>
    `Можете да оттеглите непубличната обратна връзка до ${formatDate(deadline, 'bg')}.`,
  withdrawPrivateFeedback: 'Оттегли само непубличната обратна връзка',
  privateFeedbackWindowEnded: 'Срокът за оттегляне на обратната връзка изтече.',
  ratingCorrectionUntil: (deadline) =>
    `Можете да промените оценката си до ${formatDate(deadline, 'bg')}.`,
  saveRatingCorrection: 'Запази промяната на оценката',
  changePrivateRating: 'Промени непубличната оценка',
  responseWithdrawalWindowEnded: 'Срокът за оттегляне на целия отговор изтече.',
  responseWithdrawalUntil: (deadline) =>
    `Можете да оттеглите целия отговор до ${formatDate(deadline, 'bg')}.`,
  withdrawEntireResponse: 'Оттегли целия ми отговор',
  sharedDevicePrompt:
    'Използвате споделено устройство? Можете да изчистите тази разписка за следващия посетител.',
  startNewResponse: 'Започни нов отговор',
  earlierResponseSaved: 'Вече изпратеният отговор ще остане запазен.',
  moreLinksLabel: 'Още връзки',
  moreFrom: (name) => `Още от ${name}`,
  moreDestinations: 'Още възможности',
  analyticsLabel: 'Информация за аналитичните данни на портала',
  analyticsBody:
    'Задължителна сесийна бисквитка защитава отговора ви. Отделно от това отчитаме посещението чрез краткотраен, защитен мрежов маркер. Така обектът разбира как се представя порталът за отзиви и се избягва дублирана активност.',
  analyticsAcknowledge: 'Разбрах',
}

const PACKS: Readonly<Record<GuestPortalLanguagePackVersion, GuestPortalCopy>> = {
  'guest-ui-en-v1': EN,
  'guest-ui-bg-v1': BG,
}

export function getGuestPortalCopy(
  locale: GuestPortalLocale = 'en',
  version: GuestPortalLanguagePackVersion = locale === 'bg'
    ? 'guest-ui-bg-v1'
    : 'guest-ui-en-v1',
): GuestPortalCopy {
  const pack = PACKS[version]
  if (pack.locale !== locale) {
    throw new Error('Guest locale and immutable language pack do not match')
  }
  return pack
}
