import { Home } from 'lucide-react'
import { SidebarMenu } from '#/components/ui/sidebar'
import { LinkNavItem } from './nav-items-shared'

type Props = Readonly<{
  activeSection: string
}>

type StaffNavItem = Readonly<{
  key: string
  label: string
  icon: typeof Home
  href: string
}>

const staffNavItems: ReadonlyArray<StaffNavItem> = [
  { key: 'home', label: 'Home', icon: Home, href: '/home' },
]

export function StaffNavItems({ activeSection }: Props) {
  return (
    <SidebarMenu>
      {staffNavItems.map((item) => (
        <LinkNavItem
          key={item.key}
          icon={item.icon}
          label={item.label}
          isActive={activeSection === item.key}
          link={{ to: item.href }}
        />
      ))}
    </SidebarMenu>
  )
}
