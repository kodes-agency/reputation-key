import { Copy } from 'lucide-react'

export function CopyButton({ text }: { text: string }) {
  const handleCopy = async () => {
    try {
      const fullUrl =
        typeof window !== 'undefined' ? `${window.location.origin}${text}` : text
      await navigator.clipboard.writeText(fullUrl)
    } catch {
      // fallback
    }
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
