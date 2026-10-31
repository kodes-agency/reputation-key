# Writing an update

Add a typed record in the PR that changes what managers can see. Append entries
in ascending publication-date order; use a stable `YYYY-MM-DD-short-slug` ID.
Publication starts at midnight UTC. Do not change an already published ID or date.
Future dates stay hidden until that day. Capability requirements use the existing
capability vocabulary and are checked for the current property where available.

Write for a hotel, restaurant or salon manager: what changed and how it helps.
Use a plain title (60 characters at most) and one or two short sentences (200
characters at most). A fix may have an empty body. Avoid engineering terms,
code, paths and issue references. The copy test lists forbidden words.

Choose an icon and real route from `types.ts`. Extend those finite lists and
their checks when another feature needs them. Property routes must set
`needsProperty: true`; links disappear when there is no current property.

Highlights can open the modal; fixes wait for that opening. History keeps every
eligible entry, including those from before someone joined. Entries published
before the membership's exact start instant are already seen, including on the
same day: a new person gets no backlog.
