# Guest event handlers

Guest context produces events (scan.recorded, rating.submitted, feedback.submitted, review-link.clicked) but does not consume events from other contexts.

This directory is intentionally empty — guest is an event PRODUCER only, not a consumer.

See `src/contexts/guest/CONTEXT.md` § Events consumed: "None."
