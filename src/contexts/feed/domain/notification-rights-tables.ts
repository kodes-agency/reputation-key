// The notification tables a rights purge deletes from, by scope. purge.server.ts
// deletes exactly these, and its report counts them.

export const NOTIFICATION_RIGHTS_TABLES = Object.freeze({
  organization: [
    'notification_digest_batch_members',
    'notification_digest_batches',
    'notification_email_queue',
    'notifications',
    'notification_preferences',
    'notification_category_defaults',
    'notification_property_delivery_windows',
    'notification_user_settings',
    'notification_unsubscribe_scopes',
  ],
  property: [
    'notification_digest_batch_members',
    'notification_email_queue',
    'notifications',
    'notification_preferences',
    'notification_property_delivery_windows',
    'notification_unsubscribe_scopes',
  ],
})
