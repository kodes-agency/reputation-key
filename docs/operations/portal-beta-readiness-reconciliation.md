# Portal beta-readiness reconciliation

This POR-01 command inventories retained legacy Portal rows without changing
them. It is suitable for report-first beta preparation, review evidence, and
unchanged-data reruns. It is not a migration, repair, publication, destination
approval, or provenance inference command.

## Run

```sh
pnpm ops:report-portal-beta-readiness \
  --operator <registered-operator> \
  --as-of <ISO-8601> \
  [--org <organization-id> ...]
```

`--as-of` is mandatory. Repeated `--org` values select an Organization set;
omitting them produces a global report. The operator harness records the
content-free read decision. There is no `--apply` mode.

The cutoff evaluates effective-dated group membership, token rotation grace,
artifact publication/retirement, and row creation/deletion boundaries. Tables
without retained version history are evaluated from their current stored state;
the report is deterministic for unchanged data, not a reconstructed historical
snapshot.

## Output contract

The canonical JSON contains only:

- schema version, cutoff, and Organization IDs;
- readiness boolean and counts;
- Organization, Property, Portal, source, and related IDs;
- controlled reason codes; and
- a SHA-256 fingerprint over the canonical payload.

It never includes Portal/property names, descriptions, localized text, themes,
raw link destinations, token values or digests, encrypted addresses, or
print-batch values. Database row IDs may appear as source or related IDs.

## Reason-code disposition

| Reason code                                     | Meaning and safe disposition                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creator_provenance_unknown`                    | Creator evidence is absent. Record an explicit reviewed unknown outcome; never infer a user.                                                            |
| `legacy_polymorphic_owner_unreconciled`         | A retained Team/Staff/property compatibility owner does not exactly match sole Property ownership. Keep the Portal Disabled or Archived pending review. |
| `multiple_active_group_memberships`             | More than one effective group is active for one Portal. Keep it Disabled or Archived and resolve the intervals separately.                              |
| `legacy_group_scope_invalid`                    | A static legacy group row has mismatched Organization, Property, or group-parent scope. Keep the Portal Disabled or Archived.                           |
| `legacy_group_membership_unreconciled`          | A static legacy group row has no effective-dated counterpart. Do not create one without reviewed provenance.                                            |
| `legacy_and_effective_group_disagree`           | Static legacy and effective-dated group IDs disagree. Keep the Portal Disabled or Archived.                                                             |
| `active_group_scope_invalid`                    | An active group relation has an inactive or mismatched tenant/Property parent. Keep the Portal Disabled or Archived.                                    |
| `resolvable_token_missing_access_artifact`      | A currently resolvable token lacks a published QR/NFC Access Artifact. Preserve the existing address and prepare a reviewed replacement.                |
| `print_batch_token_requires_replacement`        | A resolvable token retains `printBatch` compatibility evidence. Do not invalidate printed material until its replacement is validated.                  |
| `multiple_active_portal_tokens`                 | More than one token is marked active for a Portal. Keep publication unchanged and review address authority before replacement.                          |
| `property_brand_profile_missing`                | The owning Property has no Brand Profile. Do not manufacture brand defaults.                                                                            |
| `legacy_theme_requires_brand_classification`    | Legacy theme data still needs inheritance-versus-intentional-override review.                                                                           |
| `legacy_hero_requires_localized_classification` | A legacy hero value needs localized-override or inheritance review.                                                                                     |
| `primary_locale_content_incomplete`             | Required resolved title or short description is incomplete for the primary locale. Never copy legacy text automatically.                                |
| `additional_locale_content_incomplete`          | Required resolved title or short description is incomplete for an enabled additional locale. Never invent a translation.                                |
| `raw_secondary_link_unclassified`               | A raw URL has not entered the Approved Destination registry. Keep the link quarantined and out of publication.                                          |
| `raw_secondary_link_quarantined`                | A raw URL is already quarantined and remains excluded until separately reviewed.                                                                        |

## Review and verification

1. Retain the JSON and fingerprint with the reviewed release evidence.
2. Resolve each reason through the owning Portal command or a separately
   approved reconciliation procedure. Do not edit rows directly.
3. Keep ambiguous Portals Disabled or Archived and raw links quarantined while
   work is outstanding.
4. Rerun with the same cutoff and scope to compare unchanged data, then with a
   new approved cutoff to prove the current candidate.
5. A zero-gap report is necessary inventory evidence; it does not by itself
   authorize publication or prove the full POR-01 release journey.
