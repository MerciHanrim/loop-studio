// The notice rail — one strip under the toolbar for the notes that used to lie
// OVER the canvas: the tier-1 canvas hints (top-centre), and until 2026-10 the
// first-run update notice (top-left), which was removed with the in-app release
// notes. Whatever a diagram puts in its top band was covered until
// those were closed (measured on Coffee, share connection-editing-2/23-coffee-
// replace.md §3 / §9). Lumi (2026-10-12): solve it on the product side, in the
// toolbar / panel areas, not by shrinking a diagram or moving its rows.
//
// The rail is `#notice-rail` in App.tsx, between the toolbar and the canvas /
// Inspector row; empty, it collapses. On desktop a note PORTALS into it — its
// logic, gating, focus return and live announcements stay where they are, only
// the place changes — and the canvas is one line shorter while a note shows.
// On the phone nothing moves: the hints keep their canvas place.

import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Panel } from '@xyflow/react'
import { useIsMobile } from './media'

export const NOTICE_RAIL_ID = 'notice-rail'

/** the rail element to portal into, or null (the phone, or before mount) */
export function useNoticeRail(): HTMLElement | null {
  const isMobile = useIsMobile()
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setEl(isMobile ? null : document.getElementById(NOTICE_RAIL_ID))
  }, [isMobile])
  return el
}

/** a canvas note: in the rail on desktop, a `top-center` React Flow Panel where
 *  there is no rail (the phone). `className` / `role` are the note's own, so
 *  every existing selector and accessibility contract holds in both places. */
export function RailOrPanel({ className, role, children }: { className: string; role?: string; children: ReactNode }) {
  const rail = useNoticeRail()
  if (rail) return createPortal(<div className={`${className} notice-rail__item`} role={role}>{children}</div>, rail)
  return (
    <Panel position="top-center" className={className} role={role}>
      {children}
    </Panel>
  )
}
