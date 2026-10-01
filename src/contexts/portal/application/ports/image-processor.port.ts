// Portal context — the decoder behind the image policy.
//
// The policy (domain/portal-image-policy.ts) decides; this port reports facts
// about uploaded bytes and carries out a plan. Both throw a PortalError with
// code `image_rejected` for bytes the decoder cannot read, so a corrupt or
// hostile upload surfaces as a refusal, never as a crash.

import type {
  EncodedImage,
  ImageFacts,
  ReencodePlan,
} from '../../domain/portal-image-policy'

export type ImageProcessorPort = Readonly<{
  /** Reads the header: format, size, frames and orientation. Decodes no pixels. */
  inspect: (bytes: Uint8Array) => Promise<ImageFacts>
  /**
   * Decodes the whole image and encodes it again as the plan says. Nothing but
   * the pixels carries over: no metadata, no colour profile, no trailing data.
   */
  reencode: (bytes: Uint8Array, plan: ReencodePlan) => Promise<EncodedImage>
}>
