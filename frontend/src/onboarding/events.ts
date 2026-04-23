/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central event taxonomy for onboarding / guidance telemetry.
 *
 * Application Insights (via `PilotTelemetryService`) is the system of
 * record for the onboarding funnel (docs/onboarding/onboarding-plan-v2.md
 * — Tier A #6). Clarity stays as consented session-replay only.
 *
 * Rules:
 * - Child persona emits **nothing**. Emitter-level short-circuit.
 * - Properties carry key names only, never user content.
 */

export const ONBOARDING_EVENTS = {
  TOUR_STARTED: 'onboarding.tour_started',
  TOUR_STEP: 'onboarding.tour_step',
  TOUR_COMPLETED: 'onboarding.tour_completed',
  TOUR_DISMISSED: 'onboarding.tour_dismissed',
  CHECKLIST_ITEM_COMPLETED: 'onboarding.checklist_item_completed',
  ANNOUNCEMENT_SHOWN: 'onboarding.announcement_shown',
  ANNOUNCEMENT_DISMISSED: 'onboarding.announcement_dismissed',
  HELP_OPENED: 'onboarding.help_opened',
  HELP_TOPIC_SELECTED: 'onboarding.help_topic_selected',
  EMPTY_STATE_CTA_CLICKED: 'onboarding.empty_state_cta_clicked',
  UI_STATE_RESET: 'onboarding.ui_state_reset',
} as const

export type OnboardingEventName =
  (typeof ONBOARDING_EVENTS)[keyof typeof ONBOARDING_EVENTS]
