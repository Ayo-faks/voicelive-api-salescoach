/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Help topic registry powering the global `?` menu (v2 Phase 1 item 5)
 * and contextual popovers (Phase 3 item 12).
 *
 * Two kinds of entries live here:
 *
 *  1. Menu topics — items intended to appear in the sidebar `HelpMenu`.
 *     Typically have a `replayTourId` (to replay a tour) or an `href`
 *     (to link to docs). Include them in `MENU_HELP_TOPICS`.
 *
 *  2. Popover topics — short explanations shown by `HelpPopover` next to
 *     ambiguous UI labels. They live in the same `HELP_TOPICS` array so
 *     lookup stays O(1); the `anchorKey` field points at the label they
 *     explain (purely advisory — the render site decides the final
 *     mount point).
 *
 * All user-visible copy flows through `t()`.
 */

import { t } from './t'

export interface HelpTopic {
  /** Stable key used in telemetry (`help_topic_selected`, `help_opened`). */
  id: string
  title: string
  body: string
  /** Optional tour id to replay when the user picks this topic. */
  replayTourId?: string
  /** Optional external link for deeper docs. */
  href?: string
  /** Advisory label key — the component/label this popover sits next to.
   * Used for grep-ability; the render site decides the final mount. */
  anchorKey?: string
}

export const HELP_TOPICS: HelpTopic[] = [
  // ---- Menu topics (appear in `HelpMenu`) ---------------------------
  {
    id: 'replay-welcome-therapist',
    title: t('help.replay_welcome_therapist.title', 'Replay the welcome tour'),
    body: t(
      'help.replay_welcome_therapist.body',
      'Walks through your home, caseload, and reports in under a minute.'
    ),
    replayTourId: 'welcome-therapist',
  },
  {
    id: 'replay-welcome-admin',
    title: t('help.replay_welcome_admin.title', 'Replay the admin tour'),
    body: t(
      'help.replay_welcome_admin.body',
      'Covers caseload visibility, team settings, and the export / audit surfaces.'
    ),
    replayTourId: 'welcome-admin',
  },
  {
    id: 'replay-welcome-parent',
    title: t('help.replay_welcome_parent.title', 'Replay the parent tour'),
    body: t(
      'help.replay_welcome_parent.body',
      'Shows consent, invitations, and how to hand over to your child.'
    ),
    replayTourId: 'welcome-parent',
  },
  {
    id: 'replay-insights-rail',
    title: t('help.replay_insights_rail.title', 'Tour the Insights rail'),
    body: t(
      'help.replay_insights_rail.body',
      'Explains the question box, voice input, and how Insights cites sessions and memory.'
    ),
    replayTourId: 'insights-rail-tour',
  },
  {
    id: 'replay-dashboard',
    title: t('help.replay_dashboard.title', 'Tour the dashboard'),
    body: t(
      'help.replay_dashboard.body',
      'Sessions, plans, and reports — how the dashboard ties them to the selected child.'
    ),
    replayTourId: 'dashboard-tour',
  },
  {
    id: 'privacy-and-data',
    title: t('help.privacy_and_data.title', 'Privacy & data'),
    body: t(
      'help.privacy_and_data.body',
      'See what we store, how redaction works, and how to delete data.'
    ),
    href: '/privacy',
  },

  // ---- Popover topics (attached by `HelpPopover`) -------------------
  {
    id: 'popover-voice-mode',
    anchorKey: 'insights-rail.voice-mode',
    title: t('popover.voice_mode.title', 'Voice mode'),
    body: t(
      'popover.voice_mode.body',
      'Push-to-talk holds the mic while you press. Streaming keeps the mic on and interrupts Wulo when you speak.'
    ),
  },
  {
    id: 'popover-confidence',
    anchorKey: 'insights-rail.confidence',
    title: t('popover.confidence.title', 'Confidence'),
    body: t(
      'popover.confidence.body',
      'How sure the scoring model is about an attempt. Low confidence means the audio was short, noisy, or unclear.'
    ),
  },
  {
    id: 'popover-target-sound',
    anchorKey: 'insights-rail.target-sound',
    title: t('popover.target_sound.title', 'Target sound'),
    body: t(
      'popover.target_sound.body',
      'The phoneme the child is working on right now. Scoring and activity selection both follow this target.'
    ),
  },
  {
    id: 'popover-audience',
    anchorKey: 'reports.audience',
    title: t('popover.audience.title', 'Audience'),
    body: t(
      'popover.audience.body',
      'Who the report is written for. Parent, school, and clinical audiences all see the same data in different words.'
    ),
  },
  {
    id: 'popover-redaction',
    anchorKey: 'dashboard.redaction',
    title: t('popover.redaction.title', 'Redaction'),
    body: t(
      'popover.redaction.body',
      'Automatic removal of names and identifiers from the session transcript before it leaves the child\u2019s workspace.'
    ),
  },
  {
    id: 'popover-consent-state',
    anchorKey: 'dashboard.consent-state',
    title: t('popover.consent_state.title', 'Consent state'),
    body: t(
      'popover.consent_state.body',
      'Whether a parent has accepted the current consent statement. Sessions will not start without an active consent record.'
    ),
  },
  {
    id: 'popover-score',
    anchorKey: 'session-review.score',
    title: t('popover.score.title', 'Score'),
    body: t(
      'popover.score.body',
      'Normalised 0–100 attempt score. It blends articulation accuracy with prosody cues — not a pass / fail judgement.'
    ),
  },
  {
    id: 'popover-reference-text',
    anchorKey: 'session-review.reference-text',
    title: t('popover.reference_text.title', 'Reference text'),
    body: t(
      'popover.reference_text.body',
      'The target word or phrase the child was cued to say. Scoring compares the recognised audio against this reference.'
    ),
  },
  {
    id: 'popover-therapist-feedback',
    anchorKey: 'session-review.therapist-feedback',
    title: t('popover.therapist_feedback.title', 'Therapist feedback'),
    body: t(
      'popover.therapist_feedback.body',
      'Your own note on the session. It flows into the next plan draft and into the parent-facing summary.'
    ),
  },
  {
    id: 'popover-proposals',
    anchorKey: 'child-memory.proposals',
    title: t('popover.proposals.title', 'Proposals'),
    body: t(
      'popover.proposals.body',
      'Memory items Wulo drafted from the last session. Approve, edit, or reject — nothing reaches the live summary until you do.'
    ),
  },
  {
    id: 'popover-targets',
    anchorKey: 'child-memory.targets',
    title: t('popover.targets.title', 'Targets'),
    body: t(
      'popover.targets.body',
      'Sounds or skills the child is actively working on. Targets drive scoring focus and activity recommendations.'
    ),
  },
  {
    id: 'popover-release',
    anchorKey: 'progress-report.release',
    title: t('popover.release.title', 'Release'),
    body: t(
      'popover.release.body',
      'Publishes the report to the selected audience and records the release time in the audit log.'
    ),
  },
]

/** Subset of topics that surface in the sidebar `?` menu. Popover-only
 * topics (those without `replayTourId` or `href` and with an `anchorKey`)
 * are excluded to keep the menu focused on replayable guidance. */
export const MENU_HELP_TOPICS: HelpTopic[] = HELP_TOPICS.filter(
  topic => topic.replayTourId !== undefined || topic.href !== undefined
)
