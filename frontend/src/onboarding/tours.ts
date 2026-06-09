/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tour registry.
 *
      title: t('tour.welcome_learner.step2.title', 'Study with Wulo'),
 * - `id` — stable slug, also the key used in `ui_state.tours_seen`.
 * - `role` — audience gate (applied at runtime alongside `ui_state`).
        'One action starts the right mode: Wulo can coach, ask a quick check, or move you into practice.'
 *   when the user lands there and hasn't seen it yet.
 * - `steps` — each step declares BOTH a CSS `selector` (for the runtime
 *   driver) AND a `testId` (for the Vitest contract test required by
 *   onboarding-plan-v2.md Verification #8).
 *
 * Copy flows through `t()` so pilot adjustments are centralised.
 * See docs/onboarding/onboarding-plan-v2.md Phase 1 step 4.
 */

import { t } from './t'

export interface TourStep {
  /** CSS selector the driver should anchor the step to. */
  selector: string
  /** `data-testid` expected on the same element; lets Vitest walk tours
   * headlessly and fail on silent anchor rot (v2 Verification #8). */
  testId: string
  title: string
  body: string
  /** Joyride placement hint. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto' | 'center'
}

export type TourRole =
  | 'therapist'
  | 'admin'
  | 'parent'
  | 'pending_therapist'
  | 'learner'

export interface TourDefinition {
  id: string
  role: TourRole | TourRole[]
  autoTrigger?: { routePrefix: string }
  replayPath?: string
  steps: TourStep[]
}

/**
 * Welcome-therapist tour — the Phase 1 MVP tour that replaces the legacy
 * `OnboardingFlow` card. Four steps across `/home` → `/dashboard` hand-off.
 * Admins get their own `welcomeAdminTour`; keep this role-gated to
 * `therapist` plus `pending_therapist` so they surface a preview of the
 * caseload-centric narrative.
 */
export const welcomeTherapistTour: TourDefinition = {
  id: 'welcome-therapist',
  role: ['therapist', 'pending_therapist'],
  autoTrigger: { routePrefix: '/home' },
  replayPath: '/home',
  steps: [
    {
      selector: '[data-testid="dashboard-home-greeting"]',
      testId: 'dashboard-home-greeting',
      title: t('tour.welcome_therapist.step1.title', 'Welcome to Wulo'),
      body: t(
        'tour.welcome_therapist.step1.body',
        'Wulo is your speech-therapy copilot. Let us show you around in under a minute.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="sidebar-nav-settings"]',
      testId: 'sidebar-nav-settings',
      title: t('tour.welcome_therapist.step2.title', 'Workspace & children'),
      body: t(
        'tour.welcome_therapist.step2.body',
        'Open Workspace to add a child, manage invitations, and keep the adult setup for this account in one place.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="sidebar-nav-dashboard"]',
      testId: 'sidebar-nav-dashboard',
      title: t('tour.welcome_therapist.step3.title', 'Progress & reports'),
      body: t(
        'tour.welcome_therapist.step3.body',
        'Session history, memory, and audience-scoped reports are one click away.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="help-menu-trigger"]',
      testId: 'help-menu-trigger',
      title: t('tour.welcome_therapist.step4.title', 'Help is always here'),
      body: t(
        'tour.welcome_therapist.step4.body',
        'Open the Take a tour menu any time to replay this tour or jump to a specific topic.'
      ),
      placement: 'left',
    },
  ],
}

/**
 * first-session tour — fires once the therapist reaches `/session` for
 * the first time. Only two steps; kept short to respect focus.
 */
export const firstSessionTour: TourDefinition = {
  id: 'first-session',
  role: ['therapist', 'admin'],
  autoTrigger: { routePrefix: '/session' },
  replayPath: '/session',
  steps: [
    {
      selector: '[data-testid="session-scenario-picker"]',
      testId: 'session-scenario-picker',
      title: t('tour.first_session.step1.title', 'Choose an exercise'),
      body: t(
        'tour.first_session.step1.body',
        'Pick a scenario that matches today\u2019s target sound. You can also create a custom one.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="session-start-button"]',
      testId: 'session-start-button',
      title: t('tour.first_session.step2.title', 'Start when ready'),
      body: t(
        'tour.first_session.step2.body',
        'Microphone turns on only after you start. You can pause at any time.'
      ),
      placement: 'top',
    },
  ],
}

/**
 * Welcome-admin tour — admin-only counterpart of `welcomeTherapistTour`.
 * Emphasises caseload visibility, team settings, and the export/audit
 * surfaces that live under `/settings`. Re-uses the same shell anchors
 * so the tour ships today without requiring new surface work.
 */
export const welcomeAdminTour: TourDefinition = {
  id: 'welcome-admin',
  role: 'admin',
  // Admins land on the Pathfinder Teacher dashboard via role-gated routing
  // (see PathfinderLearnApp.defaultPathForRole). Anchor the welcome tour to
  // that surface so it actually fires on the route the user sees.
  autoTrigger: { routePrefix: '/teacher' },
  replayPath: '/teacher',
  steps: [
    {
      selector: '[data-testid="route-teacher-dashboard"]',
      testId: 'route-teacher-dashboard',
      title: t('tour.welcome_admin.step1.title', 'Welcome, admin'),
      body: t(
        'tour.welcome_admin.step1.body',
        'You have visibility across every therapist and child in your workspace. This quick tour shows the three surfaces you will use most.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="pf-nav-teacher"]',
      testId: 'pf-nav-teacher',
      title: t('tour.welcome_admin.step2.title', 'Caseload & progress'),
      body: t(
        'tour.welcome_admin.step2.body',
        'Dashboard aggregates sessions, plans, and memory across every child. Filter by therapist to audit individual caseloads.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="account-actions-trigger"]',
      testId: 'account-actions-trigger',
      title: t('tour.welcome_admin.step3.title', 'Team & export'),
      body: t(
        'tour.welcome_admin.step3.body',
        'Invite therapists, manage roles, and export audit trails from Settings. Consent records live here too.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="help-menu-trigger"]',
      testId: 'help-menu-trigger',
      title: t('tour.welcome_admin.step4.title', 'Help is one click away'),
      body: t(
        'tour.welcome_admin.step4.body',
        'Replay this tour, open the dashboard walkthrough, or revisit privacy details from the Take a tour menu at any time.'
      ),
      placement: 'left',
    },
  ],
}

/**
 * Welcome-parent tour — parent-only orientation on the family `/home`
 * landing. Focus is on consent, invitation acceptance, and the child
 * hand-off so the parent never has to hunt for those actions. Keep copy
 * parent-friendly (reading age ~ 11) and ≤ 4 steps.
 */
export const welcomeParentTour: TourDefinition = {
  id: 'welcome-parent',
  role: 'parent',
  // Parents land on the Pathfinder Profile surface via role-gated routing
  // (see PathfinderLearnApp.defaultPathForRole). Anchor the welcome tour to
  // that surface so it actually fires on the route the user sees.
  autoTrigger: { routePrefix: '/profile' },
  replayPath: '/profile',
  steps: [
    {
      selector: '[data-testid="route-student-profile"]',
      testId: 'route-student-profile',
      title: t('tour.welcome_parent.step1.title', 'Welcome to Wulo'),
      body: t(
        'tour.welcome_parent.step1.body',
        'Wulo helps your child practise speech between therapy sessions. This short tour shows the three things you will do here.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="account-actions-trigger"]',
      testId: 'account-actions-trigger',
      title: t('tour.welcome_parent.step2.title', 'Consent & invitations'),
      body: t(
        'tour.welcome_parent.step2.body',
        'Review consent, accept a therapist invite, and manage who sees your child\u2019s progress from Settings.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="pf-nav-home"]',
      testId: 'pf-nav-home',
      title: t('tour.welcome_parent.step3.title', 'Hand over to your child'),
      body: t(
        'tour.welcome_parent.step3.body',
        'When your child is ready to practise, tap Home and then the child mode card. You stay in control of which activities appear.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="help-menu-trigger"]',
      testId: 'help-menu-trigger',
      title: t('tour.welcome_parent.step4.title', 'Help & privacy'),
      body: t(
        'tour.welcome_parent.step4.body',
        'Open the Take a tour menu to replay this tour or revisit privacy details any time.'
      ),
      placement: 'left',
    },
  ],
}

/**
 * Welcome-learner tour — Pathfinder Slice 3. Seven steps across the
 * `/home` learner shell. Auto-triggers on first `/home` visit for the
 * `learner` role and on completion the page mirrors the seen state into
 * `learner_profile.tour_seen_at` so it persists across devices.
 */
export const welcomeLearnerTour: TourDefinition = {
  id: 'welcome-learner',
  role: 'learner',
  autoTrigger: { routePrefix: '/home' },
  replayPath: '/home',
  steps: [
    {
      selector: '[data-testid="learner-hero-title"]',
      testId: 'learner-hero-title',
      title: t('tour.welcome_learner.step1.title', 'Welcome to Wulo Academy'),
      body: t(
        'tour.welcome_learner.step1.body',
        'Wulo Academy learns how you study and turns it into a daily plan. This quick tour shows where everything lives.'
      ),
      placement: 'auto',
    },
    {
      selector: '[data-testid="start-learner-tutor"]',
      testId: 'start-learner-tutor',
      title: t('tour.welcome_learner.step2.title', 'Study with Wulo'),
      body: t(
        'tour.welcome_learner.step2.body',
        'One action starts the right mode: Wulo can coach, ask a quick check, or move you into practice.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="weak-topic-profile"]',
      testId: 'weak-topic-profile',
      title: t('tour.welcome_learner.step3.title', 'What we learned about you'),
      body: t(
        'tour.welcome_learner.step3.body',
        'Your weakest topics surface here so revision targets the gaps. Updates after every check-in or practice set.'
      ),
      placement: 'top',
    },
    {
      selector: '[data-testid="daily-revision-plan"]',
      testId: 'daily-revision-plan',
      title: t('tour.welcome_learner.step4.title', 'Today\u2019s plan'),
      body: t(
        'tour.welcome_learner.step4.body',
        'A short revision plan, picked to fit a single sitting. Tick items off as you go.'
      ),
      placement: 'top',
    },
    {
      selector: '[data-testid="learner-help-fab"]',
      testId: 'learner-help-fab',
      title: t('tour.welcome_learner.step5.title', 'Wulo Tutor'),
      body: t(
        'tour.welcome_learner.step5.body',
        'The same Wulo Tutor can talk it through hands-free when a learner needs coaching.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="career-pathway-suggestions"]',
      testId: 'career-pathway-suggestions',
      title: t('tour.welcome_learner.step6.title', 'Career pathways'),
      body: t(
        'tour.welcome_learner.step6.body',
        'Subject choices map to careers here. Turn on the career consent toggle in Account to make these picks personal.'
      ),
      placement: 'top',
    },
    {
      selector: '[data-testid="parent-share-summary"]',
      testId: 'parent-share-summary',
      title: t('tour.welcome_learner.step7.title', 'Sharing with adults'),
      body: t(
        'tour.welcome_learner.step7.body',
        'Send a weekly snapshot to a parent or tutor. You control what they see and when.'
      ),
      placement: 'top',
    },
  ],
}

/**
 * Insights-rail tour — therapist + admin. Walks through the right-hand
 * Insights rail: the conversation input, the voice mic affordance, and
 * the transcript where Wulo replies appear. Not auto-triggered — replay
 * from the Help menu only (the rail is not useful on first landing).
 */
export const insightsRailTour: TourDefinition = {
  id: 'insights-rail-tour',
  role: ['therapist', 'admin'],
  replayPath: '/dashboard',
  steps: [
    {
      selector: '[data-testid="insights-rail"]',
      testId: 'insights-rail',
      title: t('tour.insights_rail.step1.title', 'Ask Wulo anything'),
      body: t(
        'tour.insights_rail.step1.body',
        'Insights is your child-scoped copilot. It answers with session data, memory, and the latest plan for the child you have selected.'
      ),
      placement: 'left',
    },
    {
      selector: '[data-testid="insights-rail-input"]',
      testId: 'insights-rail-input',
      title: t('tour.insights_rail.step2.title', 'Type a prompt'),
      body: t(
        'tour.insights_rail.step2.body',
        'Ask in plain language. Wulo cites the sessions and memory items it used so you can verify every answer.'
      ),
      placement: 'top',
    },
    {
      selector: '[data-testid="insights-rail-voice-action"]',
      testId: 'insights-rail-voice-action',
      title: t('tour.insights_rail.step3.title', 'Or speak instead'),
      body: t(
        'tour.insights_rail.step3.body',
        'Tap the mic to ask by voice. Wulo interrupts cleanly when you start talking and pauses when you stop.'
      ),
      placement: 'top',
    },
  ],
}

/**
 * Dashboard tour — therapist + admin. In Pathfinder the legacy
 * `/dashboard` route redirects to `/teacher` and renders
 * `TeacherMasteryDashboard`; the legacy `ProgressDashboard` anchors no
 * longer mount, so the tour is now anchored on the Pathfinder teacher
 * mastery surfaces.
 */
export const dashboardTour: TourDefinition = {
  id: 'dashboard-tour',
  role: ['therapist', 'admin'],
  autoTrigger: { routePrefix: '/teacher' },
  replayPath: '/teacher',
  steps: [
    {
      selector: '[data-testid="route-teacher-dashboard"]',
      testId: 'route-teacher-dashboard',
      title: t('tour.dashboard.step1.title', 'Progress and planning'),
      body: t(
        'tour.dashboard.step1.body',
        'The teacher mastery dashboard brings every class, student, and pending plan into one view so you can decide what to teach next.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="weakest-subskills-list"]',
      testId: 'weakest-subskills-list',
      title: t('tour.dashboard.step2.title', 'Weakest subskills'),
      body: t(
        'tour.dashboard.step2.body',
        'Wulo Academy ranks the subskills the class is struggling with most. Tap one to see who needs help and what to schedule next.'
      ),
      placement: 'left',
    },
    {
      selector: '[data-testid="student-fact-approval-list"]',
      testId: 'student-fact-approval-list',
      title: t('tour.dashboard.step3.title', 'Approve student memory'),
      body: t(
        'tour.dashboard.step3.body',
        'Pending facts about each student wait here for your approval before they shape future plans or reports.'
      ),
      placement: 'top',
    },
    {
      selector: '[data-testid="audit-events"]',
      testId: 'audit-events',
      title: t('tour.dashboard.step4.title', 'Audit trail'),
      body: t(
        'tour.dashboard.step4.body',
        'Every approval, plan, and edit is logged here so you can show parents and leadership exactly how decisions were made.'
      ),
      placement: 'top',
    },
  ],
}

/* ----------------------------------------------------------------------
 * Parked Phase 3 tours.
 *
 * Each of the tours below is part of the Phase 3 catalogue from
 * docs/onboarding/onboarding-plan-v2.md but is NOT yet listed in
 * `ALL_TOURS` because its anchor surface either does not exist as a
 * dedicated component or lacks stable `data-testid` anchors. The tour
 * definitions are still exported so the headless selector/testId
 * contract test (`tours.test.ts` describe.each walk) can validate their
 * internal shape; register them in `ALL_TOURS` once anchors land.
 *
 * Do NOT register any of these until every selector in the tour resolves
 * in the rendered DOM — see v2 Verification #8.
 * -------------------------------------------------------------------- */

/** Session-review tour — therapist + admin. Anchors: session detail
 *  heading, transcript, therapist feedback block. */
export const sessionReviewTour: TourDefinition = {
  id: 'session-review-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="session-review-root"]',
      testId: 'session-review-root',
      title: t('tour.session_review.step1.title', 'Review a session'),
      body: t(
        'tour.session_review.step1.body',
        'Every session has a full transcript, scored attempts, and your own notes — all scoped to this child.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="session-review-transcript"]',
      testId: 'session-review-transcript',
      title: t('tour.session_review.step2.title', 'Transcript & scores'),
      body: t(
        'tour.session_review.step2.body',
        'Each line shows what was said, the scored attempt, and the reference target. Click a line to jump to that audio moment.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="session-review-feedback"]',
      testId: 'session-review-feedback',
      title: t('tour.session_review.step3.title', 'Therapist feedback'),
      body: t(
        'tour.session_review.step3.body',
        'Add a short note. Feedback flows into the next practice plan and into the parent-facing report summary.'
      ),
      placement: 'left',
    },
  ],
}

/** Child memory review tour — therapist + admin. Anchors the proposals
 *  list, the target summary, and the refresh control. */
export const childMemoryReviewTour: TourDefinition = {
  id: 'child-memory-review-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="child-memory-proposals"]',
      testId: 'child-memory-proposals',
      title: t('tour.child_memory_review.step1.title', 'Proposed memories'),
      body: t(
        'tour.child_memory_review.step1.body',
        'After each session, Wulo proposes memory items — targets, blockers, strategies. Approve the ones worth keeping.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="child-memory-summary"]',
      testId: 'child-memory-summary',
      title: t('tour.child_memory_review.step2.title', 'Active summary'),
      body: t(
        'tour.child_memory_review.step2.body',
        'Approved items roll up into a compact summary that the planner and Insights rail both read at session time.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="child-memory-refresh"]',
      testId: 'child-memory-refresh',
      title: t('tour.child_memory_review.step3.title', 'Refresh anytime'),
      body: t(
        'tour.child_memory_review.step3.body',
        'Re-run the summariser to pull in the latest approved items. The old summary is kept in the audit log.'
      ),
      placement: 'left',
    },
  ],
}

/** Family intake tour — therapist + admin. Walks through invite,
 *  consent collection, and the child proposal. */
export const familyIntakeTour: TourDefinition = {
  id: 'family-intake-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="family-intake-invite"]',
      testId: 'family-intake-invite',
      title: t('tour.family_intake.step1.title', 'Invite a family'),
      body: t(
        'tour.family_intake.step1.body',
        'Send a one-time link. The parent confirms identity and consent before any child data is captured.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="family-intake-consent"]',
      testId: 'family-intake-consent',
      title: t('tour.family_intake.step2.title', 'Consent in their words'),
      body: t(
        'tour.family_intake.step2.body',
        'The parent reviews the consent statement themselves. You see the timestamped record here once they accept.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="family-intake-child-proposal"]',
      testId: 'family-intake-child-proposal',
      title: t('tour.family_intake.step3.title', 'Approve the child'),
      body: t(
        'tour.family_intake.step3.body',
        'Review the proposed child profile, adjust if needed, and approve to add the child to your caseload.'
      ),
      placement: 'left',
    },
  ],
}

/** Custom scenario tour — therapist + admin. Triggered from the
 *  "New custom scenario" button in the scenario list. */
export const customScenarioTour: TourDefinition = {
  id: 'custom-scenario-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="custom-scenario-open"]',
      testId: 'custom-scenario-open',
      title: t('tour.custom_scenario.step1.title', 'Build a scenario'),
      body: t(
        'tour.custom_scenario.step1.body',
        'Custom scenarios let you target a specific sound, word list, or conversational task beyond the built-in library.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="custom-scenario-name"]',
      testId: 'custom-scenario-name',
      title: t('tour.custom_scenario.step2.title', 'Name & target'),
      body: t(
        'tour.custom_scenario.step2.body',
        'Pick a short name the child will recognise and declare the target sound so scoring lines up with the plan.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="custom-scenario-save"]',
      testId: 'custom-scenario-save',
      title: t('tour.custom_scenario.step3.title', 'Save & assign'),
      body: t(
        'tour.custom_scenario.step3.body',
        'Save to your library. You can assign it to a child from the Dashboard or pick it at the start of a session.'
      ),
      placement: 'top',
    },
  ],
}

/** Practice plans tour — therapist + admin. Explains the plan builder. */
export const practicePlansTour: TourDefinition = {
  id: 'practice-plans-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="practice-plan-draft"]',
      testId: 'practice-plan-draft',
      title: t('tour.practice_plans.step1.title', 'Plan drafts'),
      body: t(
        'tour.practice_plans.step1.body',
        'Each plan starts as a draft. Wulo seeds activities from the last session plus approved child memory.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="practice-plan-activities"]',
      testId: 'practice-plan-activities',
      title: t('tour.practice_plans.step2.title', 'Activities & cues'),
      body: t(
        'tour.practice_plans.step2.body',
        'Reorder, remove, or rewrite activities. Cues and success criteria update in place; nothing syncs until you approve.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="practice-plan-approve"]',
      testId: 'practice-plan-approve',
      title: t('tour.practice_plans.step3.title', 'Approve to share'),
      body: t(
        'tour.practice_plans.step3.body',
        'Approving moves the plan into the child\u2019s active queue and makes it visible to the parent.'
      ),
      placement: 'left',
    },
  ],
}

/** Progress reports tour — therapist + admin. Emphasises audience
 *  scoping; does NOT change legal/consent wording. */
export const progressReportsTour: TourDefinition = {
  id: 'progress-reports-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="progress-report-audience"]',
      testId: 'progress-report-audience',
      title: t('tour.progress_reports.step1.title', 'Audience matters'),
      body: t(
        'tour.progress_reports.step1.body',
        'Choose parent, school, or clinical. Each audience gets a tone-matched summary — the underlying data is the same.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="progress-report-summary"]',
      testId: 'progress-report-summary',
      title: t('tour.progress_reports.step2.title', 'Review the summary'),
      body: t(
        'tour.progress_reports.step2.body',
        'Wulo drafts the narrative. Edit freely; every change is versioned so the parent-facing copy can roll back.'
      ),
      placement: 'right',
    },
    {
      selector: '[data-testid="progress-report-release"]',
      testId: 'progress-report-release',
      title: t('tour.progress_reports.step3.title', 'Release when ready'),
      body: t(
        'tour.progress_reports.step3.body',
        'Releasing sends the report to the selected audience and stamps the release time in the audit log.'
      ),
      placement: 'left',
    },
  ],
}

/** Planner readiness microtour — explains the readiness criteria on
 *  the planner banner. ≤ 3 steps by design. */
export const plannerReadinessTour: TourDefinition = {
  id: 'planner-readiness-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="planner-readiness-banner"]',
      testId: 'planner-readiness-banner',
      title: t('tour.planner_readiness.step1.title', 'Planner status'),
      body: t(
        'tour.planner_readiness.step1.body',
        'This banner shows whether the AI planner is online. If it is not, plan drafts fall back to a template you can still edit.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="planner-readiness-reasons"]',
      testId: 'planner-readiness-reasons',
      title: t('tour.planner_readiness.step2.title', 'Why it is not ready'),
      body: t(
        'tour.planner_readiness.step2.body',
        'If readiness fails, the reason list tells you exactly which credential, model, or CLI is missing.'
      ),
      placement: 'right',
    },
  ],
}

/** Reports audience microtour — clarifies the audience dropdown. */
export const reportsAudienceTour: TourDefinition = {
  id: 'reports-audience-tour',
  role: ['therapist', 'admin'],
  steps: [
    {
      selector: '[data-testid="reports-audience-select"]',
      testId: 'reports-audience-select',
      title: t('tour.reports_audience.step1.title', 'Pick who reads this'),
      body: t(
        'tour.reports_audience.step1.body',
        'Parent, school, or clinical. The underlying data never changes; only the summary tone and the sections shown.'
      ),
      placement: 'bottom',
    },
    {
      selector: '[data-testid="reports-audience-help"]',
      testId: 'reports-audience-help',
      title: t('tour.reports_audience.step2.title', 'What each audience sees'),
      body: t(
        'tour.reports_audience.step2.body',
        'Hover the ? for the full field matrix. Clinical releases include raw scores; parent releases round to plain language.'
      ),
      placement: 'right',
    },
  ],
}

export const ALL_TOURS: TourDefinition[] = [
  welcomeTherapistTour,
  welcomeAdminTour,
  welcomeParentTour,
  welcomeLearnerTour,
  insightsRailTour,
  dashboardTour,
  // --------------------------------------------------------------------
  // Tours below are EXPORTED but intentionally parked (see each tour's
  // JSDoc for the missing anchor surface). They are the Phase 3 catalogue
  // from docs/onboarding/onboarding-plan-v2.md; re-add them here as the
  // anchor `data-testid`s land in their owning components so the headless
  // contract test in tours.test.ts still passes.
  //
  //   firstSessionTour,            // session-scenario-picker + session-start-button
  //   sessionReviewTour,           // SessionReview surface not yet a dedicated component
  //   childMemoryReviewTour,       // ChildMemoryPanel not yet extracted
  //   familyIntakeTour,            // Family intake rendered inline in DashboardHome
  //   customScenarioTour,          // CustomScenarioEditor anchors TBD
  //   practicePlansTour,           // Plan panel rendered inline in DashboardHome
  //   progressReportsTour,         // Report panel rendered inline in DashboardHome
  //   plannerReadinessTour,        // No dedicated banner surface yet
  //   reportsAudienceTour,         // Audience <Select> not yet mounted
  // --------------------------------------------------------------------
]

/** Lookup helper used by the tour driver. */
export function getTourById(id: string): TourDefinition | undefined {
  return ALL_TOURS.find(tour => tour.id === id)
}

export function tourSupportsRole(
  tour: TourDefinition,
  role: string | null | undefined
): boolean {
  const roles = Array.isArray(tour.role) ? tour.role : [tour.role]
  return role ? roles.includes(role as TourRole) : false
}

/** Returns the first tour whose `autoTrigger.routePrefix` matches the
 * current pathname AND that the user is eligible for, or `undefined`. */
export function pickAutoTour(args: {
  pathname: string
  role: string
  seenTourIds: string[]
  toursEnabled: boolean
}): TourDefinition | undefined {
  if (!args.toursEnabled) return undefined
  return ALL_TOURS.find(tour => {
    if (!tour.autoTrigger) return false
    if (!args.pathname.startsWith(tour.autoTrigger.routePrefix)) return false
    if (!tourSupportsRole(tour, args.role)) return false
    if (args.seenTourIds.includes(tour.id)) return false
    return true
  })
}
