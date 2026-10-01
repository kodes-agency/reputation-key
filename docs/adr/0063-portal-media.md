---
status: accepted
date: 2026-10-01
---

# 0063 — Portal media: re-encoded uploads, served same-origin

## Context

Round 4 of the Portal redesign gives a Property a photograph, a logo and a
picture on each link tile. Until now Portal has had no way to store an image:
the earlier design (a presigned browser upload, an issuance table and a
background job, removed in WP5.2b) never reached a guest, and `portal.upload`
has been `safety_blocked`, waiting for a signed SAFE-01 completion record,
named signer, independent review and four deployed drills (ADR 0032).

On 2026-09-30 the owner removed those prerequisites: the owner is the sole
developer and the beta is a closed team. The decision is to ship uploads
switched on. What the SAFE-01 package protected against is still true of
hostile bytes, so the technical safeguards stay in the build and become the
design rather than a checklist.

## Decision

1. **The server decodes and re-encodes every image.** The browser posts the raw
   bytes to `POST /api/portal-media`; the web process checks them, decodes them
   with libvips (sharp) and stores a WebP it encoded itself. The upload is never
   stored and never served, so EXIF and GPS, XMP, colour profiles, trailing
   data and polyglot payloads do not survive. There is no presigned upload, no
   issuance table and no background image job.
2. **A pure policy decides, an adapter decodes.** `portal-image-policy.ts`
   holds every limit and decision (formats, size, pixels, per-purpose minimum
   size, aspect and output budget, the orientation-aware target size); the sharp
   adapter reports facts and carries out a plan. Limits: JPEG, PNG and WebP
   only, still images only, at most 10 MiB, at most 40 million pixels, a side of
   at most 16,384, and a declared type that agrees with the leading bytes. SVG,
   GIF, HEIC, AVIF and animated PNG or WebP are refused. HEIC is refused because
   no decoder for it is enabled; logos are raster-only.
3. **The decoder is narrowed.** Only the JPEG, PNG and WebP loaders are enabled
   in libvips for the whole process, the pixel limit and fail-on-error are set
   on every decode, and at most two decodes run at once, because one decode can
   hold about 160 MB.
4. **The edge refuses cheaply and in order.** Same-origin (`Sec-Fetch-Site`, or
   an `Origin` that is the app), session, the `portal.upload` capability for the
   Property, then a per-person and per-Organization rate allowance, all before
   the body is read. The body limit is raised for that exact path only (the
   request guard's `pathBodyLimits`); every other path keeps its 1 MiB. A body
   with no declared length is counted as it arrives and cut off at the limit.
5. **The model.** `portal_media_assets` holds one row per stored image: purpose
   (`hero`, `logo`, `link_image`), status (`active`, `taken_down`), the object
   key (always `portal-media/<id>.webp`, enforced by a CHECK), size, the SHA-256
   of the stored bytes, the format the upload arrived in, and when its uploader
   confirmed the rights. The Brand Profile gains `logo_asset_id`,
   `hero_asset_id` and a focal point; a link gains `image_asset_id`. Each is a
   composite foreign key to an asset of the same Organization and Property. The
   key does not carry the purpose, so every writer of these columns must check
   it with `canReferencePortalMediaAsset` (a link picture is encoded at up to 1200 px, a
   hero at up to 2400 px with a larger minimum; the purpose chose the policy the
   image passed).
6. **Snapshots name assets by id, with no foreign key.** A guest-facing URL is
   made when the page is read, so a takedown stops an image being served without
   rewriting an immutable snapshot.
7. **Who may upload.** An Account Admin for a Property's photograph and logo
   (Property-wide branding, as for the Brand Profile); a Property Manager for the
   picture on a link tile of a Portal they manage. A Property holds at most 200
   stored images.
8. **Tenancy and lifecycle.** The table has a data-fate row, an export
   collection (the row, not the image) and a purge step ordered after every row
   that points at it.

## Consequences

- **`portal.upload` is `controlled_beta` as of slice 42b**, together with the
  amendments to `docs/BETA.md` §8 and ADR 0032 that say the SAFE-01 ceremony was
  removed by the owner on 2026-09-30 and the technical safeguards above remain.
  Slice 42a shipped the ingest behind the old fate; the switch waited for what
  this slice adds, because a stored object that nothing can delete is the one
  thing this design must not allow.
- **Serving.** A guest's browser fetches an image from
  `GET /api/public/portal-media/:assetId`, on the app's own origin (the
  bucket stays private and `img-src 'self'` is enough). There is no session and
  no tenant: the asset id is a random UUID and acts as the capability, as a
  Portal token does, and whether the asset may be served is decided from its row
  on every request. The bytes are read through the storage port, which replaced
  the AWS-only `getPublicUrl`, and are checked against the row's size and hash
  before they are sent. A published page gets its image URLs when it is read
  (never from the snapshot), so an asset that is taken down drops out of a
  snapshot that can never change. Responses are cacheable for five minutes and
  revalidated by hash; that is the longest a taken-down image stays visible to
  someone who already has it. The route has no per-request rate limit of its
  own, and an image is reachable by anyone who holds its id, including during an
  Organization's closing window, until purge removes the object.
- **Takedown.** An Account Admin takes an image down (`portal.write`, not
  `portal.upload`, so it works with uploads switched off). The row flips first
  and from then on the image is not served; the object is removed second, and a
  failure leaves `object_deleted_at` empty for the sweep to retry (migration
  0049). The row stays, because snapshots name assets by id.
- **Garbage collection.** A scheduled sweep (hourly, not capability-gated, so
  it runs when uploads are off) finishes takedown removals and deletes images
  that no Brand Profile, link or publication snapshot refers to once they are a
  day old. An image a snapshot names is kept for as long as the snapshot exists:
  snapshots are immutable and must keep verifying and rendering. The row is
  deleted and the object removed in one transaction with the row locked, object
  first, so a failed removal keeps the row for the next run and a writer
  attaching the image at that moment waits and then fails its foreign key
  instead of pointing at a deleted image. One leak remains by design: if an ingest's row insert fails
  and the cleanup delete of the just-written object also fails, the object is
  orphaned and logged (`portal_media_orphan_object`); the sweep cannot find it
  because nothing names it.
- **Purge and export.** On an Organization purge the Portal contributor removes
  the objects of the Organization's assets while the rows that name them still
  exist, then scrubs the rows; a failed removal leaves the phase `purging` and
  the next pass repeats it. The data export carries the asset rows (key, size,
  hash, status, takedown and removal times), not the image bytes.
- `sharp` is a runtime dependency with a native binding. It is externalized in
  the Nitro build and the worker bundle so it resolves from the installed
  `node_modules`, where pnpm links its platform package beside it.
- Image processing runs in the web process. A decode is bounded in memory and
  concurrency, but a burst of uploads shares the process with page rendering; the
  rate allowance is the control, and moving the decode to the worker is the
  escape hatch if it ever matters.
- Object-store configuration (`AWS_S3_*`, `S3_INTERNAL_ENDPOINT`, region
  `auto`) still has to be verified on web and worker in each deployed cell:
  uploads are on in code, and without a configured bucket the store refuses and
  nothing is stored.
- Superseded: the 10 or 15 MB, HEIC and raster-only-logo questions in the round-4
  plan are settled here as 10 MiB, no HEIC, raster-only.
