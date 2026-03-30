/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  PlusIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { useRef, useState } from 'react'
import { customScenarioService } from '../services/customScenarios'
import type { ChangeEvent, ReactElement } from 'react'
import type {
  CustomScenario,
  CustomScenarioData,
  ExerciseDifficulty,
  ExerciseType,
} from '../types'

const useStyles = makeStyles({
  dialogContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
    '@media (max-width: 680px)': {
      gridTemplateColumns: '1fr',
    },
  },
  textarea: {
    minHeight: '120px',
  },
  promptTextarea: {
    minHeight: '80px',
  },
  buttonGroup: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
  iconButton: {
    minWidth: 'auto',
  },
  errorText: {
    color: 'var(--color-error)',
    fontSize: '0.75rem',
  },
  helpText: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.75rem',
  },
})

const EXERCISE_TYPE_OPTIONS: Array<{ value: ExerciseType; label: string }> = [
  { value: 'word_repetition', label: 'Word repetition' },
  { value: 'minimal_pairs', label: 'Minimal pairs' },
  { value: 'listening_minimal_pairs', label: 'Listening minimal pairs' },
  { value: 'silent_sorting', label: 'Silent sorting' },
  { value: 'sound_isolation', label: 'Sound isolation' },
  { value: 'vowel_blending', label: 'Vowel blending' },
  { value: 'sentence_repetition', label: 'Sentence repetition' },
  { value: 'guided_prompt', label: 'Guided prompt' },
]

const DIFFICULTY_OPTIONS: Array<{
  value: ExerciseDifficulty
  label: string
}> = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

interface CustomScenarioEditorProps {
  scenario?: CustomScenario | null
  onSave: (
    name: string,
    description: string,
    scenarioData: CustomScenarioData
  ) => void
  onDelete?: (id: string) => void
  trigger?: ReactElement
}

export function CustomScenarioEditor({
  scenario,
  onSave,
  onDelete,
  trigger,
}: CustomScenarioEditorProps) {
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(scenario?.name || '')
  const [description, setDescription] = useState(scenario?.description || '')
  const [exerciseType, setExerciseType] = useState<ExerciseType>(
    scenario?.scenarioData?.exerciseType || 'word_repetition'
  )
  const [targetSound, setTargetSound] = useState(
    scenario?.scenarioData?.targetSound || ''
  )
  const [targetWords, setTargetWords] = useState(
    scenario?.scenarioData?.targetWords?.join(', ') || ''
  )
  const [difficulty, setDifficulty] = useState<ExerciseDifficulty>(
    scenario?.scenarioData?.difficulty || 'easy'
  )
  const [promptText, setPromptText] = useState(
    scenario?.scenarioData?.promptText || ''
  )
  const [systemPrompt, setSystemPrompt] = useState(
    scenario?.scenarioData?.systemPrompt || ''
  )
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEditing = !!scenario

  const handleOpen = () => {
    if (scenario) {
      setName(scenario.name)
      setDescription(scenario.description)
      setExerciseType(scenario.scenarioData.exerciseType)
      setTargetSound(scenario.scenarioData.targetSound)
      setTargetWords(scenario.scenarioData.targetWords.join(', '))
      setDifficulty(scenario.scenarioData.difficulty)
      setPromptText(scenario.scenarioData.promptText)
      setSystemPrompt(scenario.scenarioData.systemPrompt)
    } else {
      const defaults = customScenarioService.getDefaultScenarioData()
      setName('')
      setDescription('')
      setExerciseType(defaults.exerciseType)
      setTargetSound(defaults.targetSound)
      setTargetWords(defaults.targetWords.join(', '))
      setDifficulty(defaults.difficulty)
      setPromptText(defaults.promptText)
      setSystemPrompt(defaults.systemPrompt)
    }
    setError(null)
    setOpen(true)
  }

  const handleSave = () => {
    const parsedTargetWords = targetWords
      .split(',')
      .map(word => word.trim())
      .filter(Boolean)

    if (!name.trim()) {
      setError('Exercise name is required')
      return
    }
    if (!promptText.trim()) {
      setError('Practice prompt is required')
      return
    }
    if (!parsedTargetWords.length) {
      setError('Add at least one target word')
      return
    }
    if (!systemPrompt.trim()) {
      setError('Coach instructions are required')
      return
    }

    onSave(name.trim(), description.trim(), {
      exerciseType,
      targetSound: targetSound.trim(),
      targetWords: parsedTargetWords,
      difficulty,
      promptText: promptText.trim(),
      systemPrompt: systemPrompt.trim(),
    })
    setOpen(false)
  }

  const handleDelete = () => {
    if (scenario && onDelete) {
      onDelete(scenario.id)
      setOpen(false)
    }
  }

  const handleExport = () => {
    if (!scenario) return
    const json = customScenarioService.export(scenario.id)
    if (json) {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${scenario.name.replace(/\s+/g, '-').toLowerCase()}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = e => {
      try {
        const content = e.target?.result as string
        const data = JSON.parse(content) as CustomScenarioData

        if (data.systemPrompt && data.promptText) {
          setExerciseType(data.exerciseType || 'word_repetition')
          setTargetSound(data.targetSound || '')
          setTargetWords((data.targetWords || []).join(', '))
          setDifficulty(data.difficulty || 'easy')
          setPromptText(data.promptText)
          setSystemPrompt(data.systemPrompt)
          setError(null)
        } else {
          setError('Invalid format: promptText and systemPrompt are required')
        }
      } catch {
        setError('Failed to parse JSON file')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const defaultTrigger = isEditing ? (
    <Button
      appearance="subtle"
      icon={<PencilSquareIcon className="w-5 h-5" />}
      className={styles.iconButton}
      title="Edit exercise"
    />
  ) : (
    <Button appearance="primary" icon={<PlusIcon className="w-5 h-5" />}>
      Create Exercise
    </Button>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (data.open) {
          handleOpen()
          return
        }

        setOpen(false)
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {isEditing ? 'Edit Exercise' : 'Create Exercise'}
          </DialogTitle>
          <DialogContent className={styles.dialogContent}>
            <Field label="Exercise Name" required>
              <Input
                value={name}
                onChange={(_, data) => setName(data.value)}
                placeholder="e.g., Sunny S Words"
              />
            </Field>

            <Field label="Description">
              <Input
                value={description}
                onChange={(_, data) => setDescription(data.value)}
                placeholder="Brief note for the therapist"
              />
            </Field>

            <div className={styles.fieldGrid}>
              <Field label="Exercise Type" required>
                <Dropdown
                  value={
                    EXERCISE_TYPE_OPTIONS.find(
                      option => option.value === exerciseType
                    )?.label
                  }
                  selectedOptions={[exerciseType]}
                  onOptionSelect={(_, data) =>
                    setExerciseType(data.optionValue as ExerciseType)
                  }
                >
                  {EXERCISE_TYPE_OPTIONS.map(option => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>

              <Field label="Difficulty" required>
                <Dropdown
                  value={
                    DIFFICULTY_OPTIONS.find(
                      option => option.value === difficulty
                    )?.label
                  }
                  selectedOptions={[difficulty]}
                  onOptionSelect={(_, data) =>
                    setDifficulty(data.optionValue as ExerciseDifficulty)
                  }
                >
                  {DIFFICULTY_OPTIONS.map(option => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>

              <Field label="Target Sound">
                <Input
                  value={targetSound}
                  onChange={(_, data) => setTargetSound(data.value)}
                  placeholder="e.g., s"
                />
              </Field>

              <Field label="Target Words" required hint="Comma-separated words">
                <Input
                  value={targetWords}
                  onChange={(_, data) => setTargetWords(data.value)}
                  placeholder="sun, sock, soap"
                />
              </Field>
            </div>

            <Field
              label="Practice Prompt"
              required
              hint="What the child is asked to say or do"
            >
              <Textarea
                value={promptText}
                onChange={(_, data) => setPromptText(data.value)}
                className={`${styles.textarea} ${styles.promptTextarea}`}
                placeholder="Let's practice the /s/ sound together. Say each word after me."
                resize="vertical"
              />
            </Field>

            <Field
              label="Coach Instructions"
              required
              hint="Define how the AI coach should guide the child during practice"
            >
              <Textarea
                value={systemPrompt}
                onChange={(_, data) => setSystemPrompt(data.value)}
                className={styles.textarea}
                placeholder="You are Wulo, a warm and playful speech practice buddy..."
                resize="vertical"
              />
            </Field>

            <Text className={styles.helpText}>
              Use the practice prompt for the child-facing task and coach
              instructions for the AI's tone, pacing, and encouragement.
            </Text>

            <Text className={styles.helpText}>
              💾 Custom exercises are stored locally in your browser and won't
              sync across devices.
            </Text>

            {error && <Text className={styles.errorText}>{error}</Text>}

            <div className={styles.buttonGroup}>
              <Button
                appearance="subtle"
                icon={<ArrowUpTrayIcon className="w-5 h-5" />}
                onClick={handleImportClick}
              >
                Import JSON
              </Button>
              {isEditing && (
                <Button
                  appearance="subtle"
                  icon={<ArrowDownTrayIcon className="w-5 h-5" />}
                  onClick={handleExport}
                >
                  Export JSON
                </Button>
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileImport}
            />
          </DialogContent>
          <DialogActions>
            {isEditing && onDelete && (
              <Button
                appearance="subtle"
                icon={<TrashIcon className="w-5 h-5" />}
                onClick={handleDelete}
                style={{ marginRight: 'auto' }}
              >
                Delete
              </Button>
            )}
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">Cancel</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleSave}>
              {isEditing ? 'Save Changes' : 'Create Exercise'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
