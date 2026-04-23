/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Phase 4 child-onboarding barrel.
 *
 * Imported via ``React.lazy`` from ``App.tsx`` so adult boots do not
 * pay the bundle cost, and child tablets do not pay the adult
 * onboarding cost.
 */

export { ChildMascot } from './ChildMascot'
export type { ChildMascotProps } from './ChildMascot'
export { ChildSpotlight } from './ChildSpotlight'
export type { ChildSpotlightProps } from './ChildSpotlight'
export { HandOffInterstitial } from './HandOffInterstitial'
export type { HandOffInterstitialProps } from './HandOffInterstitial'
export { ChildWrapUpCard } from './ChildWrapUpCard'
export type { ChildWrapUpCardProps } from './ChildWrapUpCard'
export { SilentSortingTutorial } from './SilentSortingTutorial'
export type { SilentSortingTutorialProps } from './SilentSortingTutorial'
export { ChildOnboardingOrchestrator } from './ChildOnboardingOrchestrator'
export type { ChildOnboardingOrchestratorProps } from './ChildOnboardingOrchestrator'
