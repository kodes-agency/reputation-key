// The glyph of each editor section, shared by the section list and the flag the
// preview puts on the part of the page being edited, so a section looks the same in both.

import {
  Languages,
  Layers,
  LayoutGrid,
  MessageSquareText,
  Palette,
  PanelBottom,
  Star,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { PortalEditorSection } from './portal-editor-sections'

export const PORTAL_EDITOR_SECTION_ICONS: Readonly<
  Record<PortalEditorSection, LucideIcon>
> = {
  look: Palette,
  welcome: Type,
  rating: Star,
  'private-note': MessageSquareText,
  linktree: LayoutGrid,
  footer: PanelBottom,
  languages: Languages,
  group: Layers,
  responsible: UserRound,
}
