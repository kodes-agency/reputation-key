# Dashboard Overview — AI Design Prompt

> Dense prompt for generating the property-scoped dashboard overview page.

## Prompt

A reputation-management dashboard for a hospitality SaaS — KPI strip with 4 cards (total reviews, average rating, total scans, conversion rate) each showing period-over-period delta arrows, two side-by-side time-series charts (daily average rating line chart, daily scan count area chart), a recent reviews list (5 rows: star rating, reviewer name, snippet, platform badge, time ago), a recent feedback list (3 rows: rating, category badge, comment snippet, portal name, time ago), and a time range selector (7d/30d/90d/custom). Property-scoped, role-aware. Dark theme, tabular numerals, subtle card borders, compact spacing.

## Layout Spec

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard · {Property Name}           [7d] [30d] [90d] [↔] │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Reviews  │ │ Avg Rat. │ │  Scans   │ │ Conv. %  │       │
│  │    142   │ │   4.3    │ │   1,208  │ │  11.8%   │       │
│  │  ↑ 12%   │ │  ↓ 0.2   │ │  ↑ 23%   │ │  ↑ 1.4%  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├───────────────────────────┬─────────────────────────────────┤
│  Rating Over Time         │  Scan Count Over Time           │
│  (line chart)             │  (area chart)                   │
│                           │                                 │
├───────────────────────────┴─────────────────────────────────┤
│  Recent Reviews                              [View all →]   │
│  ─────────────────────────────────────────────────────────── │
│  ★★★★☆  John D.  "Great service, would reco..."  Google 2h │
│  ★★★★★  Maria S. "Absolutely fantastic ..."     Google 5h │
│  ★★☆☆☆  Alex K.  "Room was not clean, ..."      Google 1d │
│  ★★★★☆  Lisa M.  "Loved the breakfast ..."      Google 1d │
│  ★★★★★  Tom R.   "Perfect location, ..."        Google 2d │
├─────────────────────────────────────────────────────────────┤
│  Recent Feedback                            [View all →]    │
│  ─────────────────────────────────────────────────────────── │
│  ★★☆☆☆  [Service]  "Wait time was too long..."  Lobby 3h  │
│  ★★★☆☆  [Cleanliness] "Bathroom could be..."   Room 7h   │
│  ★★★★☆  [Food Quality] "Breakfast was g..."    Dining 1d │
└─────────────────────────────────────────────────────────────┘
```
