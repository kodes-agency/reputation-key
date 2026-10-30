import {
  Users,
  Clock,
  CalendarCheck,
  Sparkles,
  Utensils,
  Brush,
  Wrench,
  Receipt,
  Volume2,
  MapPin,
  Shield,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'
const ICONS: Readonly<Record<ReviewTopicV3, LucideIcon>> = {
  staff_service: Users,
  speed_waiting: Clock,
  booking_arrival: CalendarCheck,
  main_service: Sparkles,
  food_drink: Utensils,
  cleanliness: Brush,
  facilities_equipment: Wrench,
  price_billing: Receipt,
  atmosphere_noise: Volume2,
  location_access: MapPin,
  safety: Shield,
  communication: MessageCircle,
}
export function GuestVoiceTopicIcon({
  topic,
  row = false,
}: Readonly<{ topic: ReviewTopicV3; row?: boolean }>) {
  const Icon = ICONS[topic]
  return (
    <Icon
      aria-hidden="true"
      className={
        row ? 'hidden size-5 shrink-0 text-muted-foreground md:block' : 'size-4 shrink-0'
      }
    />
  )
}
