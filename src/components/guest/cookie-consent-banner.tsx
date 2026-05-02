import { useState, useEffect } from 'react'
import { Button } from '#/components/ui/button'
import { X } from 'lucide-react'

const CONSENT_KEY = 'guest-cookie-consent'

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hasConsented = localStorage.getItem(CONSENT_KEY)
    if (!hasConsented) {
      setVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(CONSENT_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          We use a session cookie to prevent duplicate ratings. No personal data is
          collected.
        </p>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
