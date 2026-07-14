# Request for clarification on AI-assisted processing of Google Business Profile reviews

**Submitted to:** Google Business Profile APIs team  
**Submitted by:** Reputation Key (RepKey) product team  
**Contact:** denev@kodes.agency  
**Date:** 14 July 2026  
**Google Cloud project number:** Supplied in the associated support case  
**Implementation status:** Proposed; not enabled in production

## Purpose of this request

Reputation Key is a review-management service for hotels and other multi-location businesses. A manager connects a Google Business Profile account through Google OAuth, and RepKey retrieves reviews only for locations that the customer owns or is authorized to manage.

Before implementing the functionality described below, we are asking Google to clarify how the Business Profile API content-storage and automated-use policies apply. In particular, we need to understand the restrictions on manipulating or aggregating API content, the 30-day storage limit, and the use of an external language-model provider.

We are requesting written guidance so that we can either implement the features with the required safeguards or leave them out of the product.

## Proposed functionality

### Review analysis

When a new review is received, RepKey would send a minimized payload to a business-grade language-model API. The payload would contain the review text, star rating, review date, language, and limited property context. It would exclude the reviewer's name, profile URL, profile photo, and other reviewer metadata.

The model would return a sentiment classification and a general service category, such as cleanliness, service, location, or value. RepKey would calculate a priority score using the star rating, sentiment result, and age of the review. These results would be visible only to users authorized to manage that property.

### Reply drafting

An authorized manager could choose **Generate reply draft** for an individual review. The model may receive up to three replies previously published by that same property as style examples. The result would remain an editable draft. Publishing would require a separate, deliberate action by the manager. RepKey would not automatically publish a generated reply.

### Per-property themes and summaries

Once per day, RepKey would analyze a bounded set of recent reviews from one property, expected to be no more than 100 reviews. The result would identify recurring themes, whether a theme appears to be improving or worsening, and a short summary for that property. Reviews from different properties would not be combined, and no organization-level summary would be produced.

### Optional historical analysis

When a customer first connects a property, RepKey may offer an optional one-time analysis of existing reviews. This would use the same minimized data and produce the same per-review classifications. It would not be used to train or fine-tune a model.

## Proposed data flow

1. An authorized manager connects a Google Business Profile account through OAuth.
2. RepKey retrieves reviews for locations that the manager is authorized to manage.
3. RepKey removes reviewer identity fields before any model request.
4. A contracted model provider processes the minimized request and returns a result.
5. RepKey shows the result only to authorized users of the same property.
6. Reply publication always requires a separate user action through the Reviews API.

## Proposed safeguards

The provider has not yet been selected. Options under consideration include the OpenAI API, Azure OpenAI, and models available through AWS Bedrock. Selection depends in part on Google's guidance.

- Customer content would not be used for model training.
- RepKey would select the shortest available provider retention setting.
- US or European regional processing would be used where required.
- Reviewer identity fields would not be sent to the model.
- Prompts and model responses would not be written to ordinary application logs.
- AI processing would be separately enabled by the customer and could be disabled later.
- RepKey would keep an audit record of model, region, token usage, and processing outcome without placing review content in the audit log.
- AI failure or quota exhaustion would not affect access to non-AI review-management features.

## Points requiring clarification

1. May minimized Business Profile review content be sent to a contracted external language-model provider for sentiment classification, categorization, priority scoring support, and reply drafting?
2. Is creating and retaining sentiment labels, categories, or priority scores considered prohibited manipulation of Business Profile API content?
3. Is identifying themes and producing a summary from reviews belonging to one property considered prohibited aggregation, even when properties are never combined and the result is only visible to that property's authorized manager?
4. Does the 30-day storage limit apply only to the review content returned by the API, or also to derived values such as labels, scores, themes, trajectories, and summaries?
5. If derived results are permitted, may they be retained after the underlying API content is refreshed or deleted? What must be deleted when a customer disconnects the Google Business Profile account?
6. Is an optional one-time analysis of existing reviews allowed, or would that be considered prohibited pre-fetching, caching, or indexing?
7. May up to three replies previously published by the same property be used as style examples when generating a new draft?
8. For review analysis, is OAuth authorization followed by a clear customer-controlled AI opt-in sufficient? For replies, do separate **Generate draft** and **Publish reply** actions satisfy the requirement for prior specific and express consent?
9. Does Google impose requirements on the model provider, processing location, retention period, data-processing agreement, or subprocessors beyond the published Business Profile API and Google API user-data policies?

## Requested response

We would appreciate written confirmation for each point above, including any conditions that would make the proposed use acceptable. If these questions require policy interpretation rather than ordinary technical support, please refer the case to the Google Business Profile API policy team.

## References

- Google Business Profile API policies: https://developers.google.com/my-business/content/policies
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Google APIs Terms of Service: https://developers.google.com/terms/
