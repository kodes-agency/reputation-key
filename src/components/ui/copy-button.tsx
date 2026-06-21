import { Copy } from 'lucide-react'
import { copyToClipboard } from '#/lib/clipboard'

export function CopyButton({ text }: { text: string }) {
  const handleCopy = async () => {
    const fullUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${text}` : text
    await copyToClipboard(fullUrl)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 hover:bg-muted rounded transition-colors"
      title="Copy URL"
    >
      <Copy className="size-3 text-muted-foreground" />
    </button>
  )
}
