import { createFileRoute } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 size-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 size-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <Badge variant="secondary" className="island-kicker mb-3">
          Reputation Key
        </Badge>
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight sm:text-6xl">
          Manage your reputation, grow your business.
        </h1>
        <p className="mb-8 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Monitor reviews, collect feedback, and build trust — all in one place.
        </p>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Review Management', 'Monitor and respond to reviews across platforms.'],
          [
            'Smart Feedback',
            'Collect private feedback and route happy guests to public reviews.',
          ],
          ['Team Dashboards', 'Track performance with goals, badges, and leaderboards.'],
          ['AI-Powered', 'Sentiment analysis, reply drafting, and trend detection.'],
        ].map(([title, desc], index) => (
          <Card
            key={title}
            className="island-shell feature-card rise-in"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <CardHeader>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{desc}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}
