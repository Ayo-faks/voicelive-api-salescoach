/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CustomScenario, CustomScenarioData } from '../types'

const STORAGE_KEY = 'wulo_custom_exercises'
const LEGACY_STORAGE_KEY = 'voicelive_custom_scenarios'

function getDefaultScenarioData(): CustomScenarioData {
  return {
    exerciseType: 'word_repetition',
    targetSound: '',
    targetWords: ['sun', 'sock', 'soap'],
    difficulty: 'easy',
    promptText:
      'Let\'s practice the /s/ sound together. Say each word slowly after me.',
    systemPrompt: `You are Wulo, a warm and playful speech practice buddy helping a child with a therapist-supervised exercise.

EXERCISE STYLE:
- Give one short instruction at a time
- Celebrate effort and retries
- Model the target sound clearly when needed
- Keep every reply to one or two short sentences
- Never sound clinical, corrective, or critical

SESSION FLOW:
1. Invite the child to listen and repeat
2. Focus on the target sound or words for this exercise
3. Encourage another try when needed with calm, positive language
4. End with a short celebration of effort

Use child-facing language like "Let\'s practice!", "Tap to talk!", and "Great trying!".`,
  }
}

function normalizeScenarioData(
  scenarioData?: Partial<CustomScenarioData> | null
): CustomScenarioData {
  const defaults = getDefaultScenarioData()

  return {
    ...defaults,
    ...scenarioData,
    targetWords:
      Array.isArray(scenarioData?.targetWords) && scenarioData?.targetWords.length
        ? scenarioData.targetWords
        : defaults.targetWords,
  }
}

function normalizeScenario(scenario: CustomScenario): CustomScenario {
  return {
    ...scenario,
    scenarioData: normalizeScenarioData(scenario.scenarioData),
  }
}

/**
 * Service for managing custom scenarios in browser localStorage
 */
export const customScenarioService = {
  /**
   * Get all custom scenarios from localStorage
   */
  getAll(): CustomScenario[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY)

      if (!stored && legacyStored) {
        const migrated = (JSON.parse(legacyStored) as CustomScenario[]).map(
          normalizeScenario
        )
        this._persist(migrated)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        return migrated
      }

      if (!stored) return []

      return (JSON.parse(stored) as CustomScenario[]).map(normalizeScenario)
    } catch (error) {
      console.error('Failed to load custom scenarios:', error)
      return []
    }
  },

  /**
   * Get a specific custom scenario by ID
   */
  get(id: string): CustomScenario | null {
    const scenarios = this.getAll()
    return scenarios.find(s => s.id === id) || null
  },

  /**
   * Save a new custom scenario
   */
  save(
    name: string,
    description: string,
    scenarioData: CustomScenarioData
  ): CustomScenario {
    const scenarios = this.getAll()
    const now = new Date().toISOString()
    const id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    const newScenario: CustomScenario = {
      id,
      name,
      description,
      is_custom: true,
      scenarioData: normalizeScenarioData(scenarioData),
      createdAt: now,
      updatedAt: now,
    }

    scenarios.push(newScenario)
    this._persist(scenarios)
    return newScenario
  },

  /**
   * Update an existing custom scenario
   */
  update(
    id: string,
    updates: Partial<
      Pick<CustomScenario, 'name' | 'description' | 'scenarioData'>
    >
  ): CustomScenario | null {
    const scenarios = this.getAll()
    const index = scenarios.findIndex(s => s.id === id)

    if (index === -1) return null

    const updated: CustomScenario = {
      ...scenarios[index],
      ...updates,
      scenarioData: updates.scenarioData
        ? normalizeScenarioData(updates.scenarioData)
        : scenarios[index].scenarioData,
      updatedAt: new Date().toISOString(),
    }

    scenarios[index] = updated
    this._persist(scenarios)
    return updated
  },

  /**
   * Delete a custom scenario
   */
  delete(id: string): boolean {
    const scenarios = this.getAll()
    const filtered = scenarios.filter(s => s.id !== id)

    if (filtered.length === scenarios.length) return false

    this._persist(filtered)
    return true
  },

  /**
   * Export a custom scenario as JSON
   */
  export(id: string): string | null {
    const scenario = this.get(id)
    if (!scenario) return null
    return JSON.stringify(scenario.scenarioData, null, 2)
  },

  /**
   * Get default system prompt for new scenarios
   */
  getDefaultSystemPrompt(): string {
    return getDefaultScenarioData().systemPrompt
  },

  /**
   * Get the default custom exercise template
   */
  getDefaultScenarioData(): CustomScenarioData {
    return getDefaultScenarioData()
  },

  /**
   * Internal method to persist scenarios to localStorage
   */
  _persist(scenarios: CustomScenario[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios))
    } catch (error) {
      console.error('Failed to persist custom scenarios:', error)
      throw new Error('Failed to save scenario. Storage may be full.')
    }
  },
}
