# Restatement of AI processing region and prompt-cache retention

**Submitted to:** Google Business Profile APIs team  
**Submitted by:** Reputation Key (RepKey) product team  
**Contact:** denev@kodes.agency  
**Date:** 8 September 2026  
**Google Cloud project number:** Supplied in the associated support case  
**Implementation status:** Closed-beta controls implemented; further activation awaits this restatement  
**Response status:** Pending — not yet sent (sending is the product owner's action)

## Purpose of this restatement

Before any further activation, Reputation Key is restating two facts in the
architecture described in our 14 July 2026 request: the OpenAI processing region
and the prompt-cache retention period. This letter narrows and corrects the
prior statements; it does not request a broader use of Google Business Profile
data.

## Processing region

The beta sends minimized and redacted AI inputs to OpenAI's global API endpoint.
It has no regional OpenAI processing profile and no provider residency
commitment.

Reputation Key hosting is separate from provider processing. The beta has one
Railway deployment in the United States, in Railway's US West/California
placement. It has no EU
deployment.

We withdraw the earlier beta statement, “Route through the property's approved
US/EU/other processing profile with no silent global fallback”. For this beta,
the accurate statement is: OpenAI processing uses the global API endpoint with
no provider residency commitment, while Reputation Key hosting is in the United
States.

## Prompt-cache retention

The previous merchant notice said that prompt caching was volatile and lasted at
most one hour. That was incorrect: each request uses
`prompt_cache_retention: '24h'`, and the pinned model does not support the stated
in-memory mode.

The current merchant notice is
`MERCHANT_AI_NOTICE_VERSION = 'merchant-ai-notice-2026-09-06.v1'`. It states
24-hour extended prompt caching and that cached prompt prefixes may persist with
OpenAI for up to 24 hours. This letter re-notifies
Google of that correction before further activation.

## Requested record update

Please add this restatement to the support record for the original request and
read its two corrected statements together with the current merchant notice.
The response status above remains pending until the product owner sends this
letter and preserves the resulting correspondence.

## References

- [Original request](google-business-profile-ai-policy-clarification.md)
- [Google response and internal disposition](google-business-profile-ai-policy-response-2026-07-14.md)
- [Current privacy notice](../../legal/privacy-notice.md)
- [Google Business Profile Access Disclosure](../../legal/google-access-disclosure.md)

## Internal evidence (not part of the letter)

- `src/shared/ai-openai-provider-profile.ts:72,85,239-240`;
  `src/shared/merchant-ai-notice-contract.ts:61,97-99,176`
- `docs/operations/backup-and-lifecycle.md:324-330`
- `google-business-profile-ai-policy-response-2026-07-14.md:104`
- `src/shared/merchant-ai-notice-contract.ts:4-8`
- `src/shared/merchant-ai-notice-contract.ts:13,97`;
  `src/shared/ai-openai-provider-profile.ts:80,202`
