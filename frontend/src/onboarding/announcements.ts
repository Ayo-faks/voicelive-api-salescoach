/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Announcement banner registry (v2 Phase 2). Populated per-release.
 */

import { t } from './t'

export type AnnouncementSeverity = 'info' | 'success' | 'warning'

export interface Announcement {
  /** Stable slug — lives in `ui_state.announcements_dismissed` once the user dismisses. */
  id: string
  severity: AnnouncementSeverity
  title: string
  body: string
  /** When set, the announcement auto-expires on or after this ISO date. */
  expiresAt?: string
  /** Optional CTA — href or route; clicking also dismisses the announcement. */
  cta?: { label: string; href: string }
  /** Role(s) that should see the announcement. */
  role?: Array<'therapist' | 'admin' | 'parent'>
}

export const ANNOUNCEMENTS: Announcement[] = [
  // Empty by default; Phase 2+ populates this list.
]

export function listVisibleAnnouncements(args: {
  role: string
  dismissed: string[]
  now?: Date
}): Announcement[] {
  const now = args.now ?? new Date()
  return ANNOUNCEMENTS.filter(entry => {
    if (args.dismissed.includes(entry.id)) return false
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now.getTime()) {
      return false
    }
    if (entry.role && !entry.role.includes(args.role as 'therapist' | 'admin' | 'parent')) {
      return false
    }
    return true
  })
}
