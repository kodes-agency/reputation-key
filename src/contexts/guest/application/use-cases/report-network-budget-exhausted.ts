import type { LoggerPort } from '#/shared/domain/logger.port'

/**
 * The closed set of guest actions that have a network-and-Portal budget. The
 * caller names the action; nothing from the request can become a value here.
 */
export type GuestNetworkBudgetAction =
  | 'submit'
  | 'correct'
  | 'feedback'
  | 'feedback_withdraw'
  | 'response_withdraw'
  | 'new_response'
  | 'google'
  | 'secondary'
  | 'scan'

export type ReportGuestNetworkBudgetExhaustedDeps = Readonly<{ logger: LoggerPort }>

export type GuestNetworkBudgetExhaustion = Readonly<{ action: GuestNetworkBudgetAction }>

/**
 * One content-free warning when the guests of a Portal behind one public address
 * (a hotel, a restaurant, a salon on guest Wi-Fi) used up a network-and-Portal
 * budget. It is how an operator finds out that a venue is meeting its budget. The
 * line names the event and the action and nothing else: never the address, its
 * pseudonym, a session or any request content, and, by the log policy (BQC-7.3,
 * which bans tenant identifiers in log objects), not the Organization or the
 * Portal either.
 */
export const reportGuestNetworkBudgetExhausted =
  (deps: ReportGuestNetworkBudgetExhaustedDeps) =>
  (input: GuestNetworkBudgetExhaustion): void => {
    try {
      deps.logger.warn(
        {
          event: 'guest.network_budget_exhausted',
          action: input.action,
        },
        'Guest network budget exhausted',
      )
    } catch {
      // Logging is the last-resort signal, never public-journey authority.
    }
  }

export type ReportGuestNetworkBudgetExhausted = ReturnType<
  typeof reportGuestNetworkBudgetExhausted
>
