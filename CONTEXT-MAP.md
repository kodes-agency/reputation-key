# Context Map

## Contexts

- [Identity](./src/contexts/identity/) — user authentication, sessions, organization membership
- [Property](./src/contexts/property/) — physical locations (hotels, restaurants, etc.) owned by organizations
- [Team](./src/contexts/team/) — staff team groupings within organizations
- [Staff](./src/contexts/staff/) — staff assignments linking users to properties and teams
- [Portal](./src/contexts/portal/) — branded review-request pages with link trees, themes, and smart routing config
- [Guest](./src/contexts/guest/) — guest-facing interactions: scans, ratings, feedback, review-link clicks
- [Review](./src/contexts/review/) — external review ingestion (GBP, etc.), unified inbox, replies (planned)
- [Metric](./src/contexts/metric/) — aggregated reputation metrics and dashboards (planned)
- [Gamification](./src/contexts/gamification/) — goals, badges, leaderboards (planned)
- [Notification](./src/contexts/notification/) — alerts and notifications to managers (planned)
- [AI](./src/contexts/ai/) — sentiment analysis, reply drafting, trend detection (planned)
- [Audit](./src/contexts/audit/) — audit trail and compliance logging (planned)

## Relationships

- **Organization → Property**: An organization owns one or more properties
- **Property → Portal**: A property can have multiple portals
- **Portal → Guest**: A portal emits scan events when guests visit; guests submit ratings and feedback tied to a portal
- **Guest → Review**: Guest ratings and feedback are internal; external reviews from GBP are ingested separately by the Review context
- **Guest → Metric**: Guest interactions (scans, ratings, feedback, clicks) feed into reputation metrics
- **Review → Metric**: External reviews feed into reputation metrics
- **Metric → Gamification**: Metrics drive goals, badges, and leaderboards
- **Metric → Notification**: Metrics trigger alerts to managers
- **AI → Review**: AI provides sentiment analysis and reply drafting for reviews
- **Audit → all contexts**: Audit context consumes events from all other contexts for compliance logging
