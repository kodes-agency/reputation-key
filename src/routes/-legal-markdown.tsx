import { Marked } from 'marked'

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

function headingSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || 'section'
}

export function renderLegalMarkdown(source: string): string {
  const headingCounts = new Map<string, number>()
  const parser = new Marked({
    async: false,
    gfm: true,
    renderer: {
      heading({ depth, text, tokens }) {
        const base = text === '9. Changes and contact' ? 'contact' : headingSlug(text)
        const count = headingCounts.get(base) ?? 0
        headingCounts.set(base, count + 1)
        const id = count === 0 ? base : `${base}-${count + 1}`

        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
    },
  })

  return parser.parse(source.replace(FRONT_MATTER, ''), { async: false })
}

export function LegalMarkdown({ html }: Readonly<{ html: string }>) {
  return (
    <div className="page-wrap px-4 py-12 sm:px-6 sm:py-16">
      <article
        className="prose prose-neutral dark:prose-invert mx-auto max-w-4xl overflow-x-auto prose-headings:scroll-mt-24 prose-headings:font-display prose-a:font-medium prose-a:underline prose-a:underline-offset-4 prose-table:text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
