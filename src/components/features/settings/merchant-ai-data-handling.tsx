import { ShieldCheck } from 'lucide-react'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'

export function MerchantAiDataHandling({
  notice,
}: Readonly<{ notice: MerchantAiNoticeDto }>) {
  const { payload } = notice

  return (
    <section aria-labelledby="merchant-ai-data-handling" className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" />
        <h2 id="merchant-ai-data-handling" className="font-semibold">
          Data handling and risks
        </h2>
      </div>
      {payload.sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{section.title}</h3>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-sm text-muted-foreground">
              {paragraph}
            </p>
          ))}
          {section.links.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {section.links.map((link) => {
                const external = link.target.startsWith('https://')
                return (
                  <li key={link.target}>
                    <a
                      href={link.target}
                      className="font-medium underline underline-offset-4"
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noreferrer' : undefined}
                    >
                      {link.label}
                      {external ? (
                        <span className="sr-only"> (opens in a new tab)</span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ))}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {payload.retentionAndRevocation.map((row) => (
          <div key={row.id} className="rounded-md border p-3">
            <dt className="font-medium">{row.label}</dt>
            <dd className="mt-1 text-muted-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="text-sm font-medium">Known risks</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {payload.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        Processing region: {payload.processingRegion}. Notice version: {notice.version}.
        Digest: <span className="break-all font-mono">{notice.digest}</span>.
      </p>
    </section>
  )
}
