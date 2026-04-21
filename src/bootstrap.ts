// Bootstrap — registers event handlers and background jobs at startup.
// This is separate from composition.ts so that construction and registration
// are easy to understand independently.
//
// Per architecture: "Keeping registration separate from construction
// makes both easier to understand."

import type { Container } from './composition'

export function bootstrap(_container: Container): void {
  // Register event handlers here as contexts are added.
  // Example:
  //   container.eventBus.on('portal.created', (event) => { ... })
  //
  // Register BullMQ job handlers here.
  // Example:
  //   container.worker.register('sync-reviews', syncReviewsHandler)
  //
}
