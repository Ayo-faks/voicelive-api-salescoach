/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Text, makeStyles } from '@fluentui/react-components'
import { useEffect, useMemo, useState } from 'react'
import { getImageAssetUrl } from '../services/api'
import type { ExerciseMetadata } from '../types'
import type { MicMode } from '../utils/micMode'
import { RepetitionCounter } from './RepetitionCounter'

const useStyles = makeStyles({
  card: {
    padding: 'var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
    display: 'grid',
    gap: 'var(--space-md)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    // PR9 — teal panel title anchors each exercise card to the brand palette.
    color: 'var(--color-primary-dark)',
    fontSize: '1rem',
    fontWeight: '700',
  },
  body: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: '0.84rem',
  },
  cueWrap: {
    display: 'grid',
    gridTemplateColumns: 'minmax(92px, 120px) 1fr',
    gap: 'var(--space-md)',
    alignItems: 'center',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  cueImageFrame: {
    width: '100%',
    maxWidth: '120px',
    aspectRatio: '1 / 1',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    backgroundColor: 'var(--color-primary-softer)',
    border: '1px solid rgba(13, 138, 132, 0.18)',
  },
  cueImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  rail: {
    display: 'grid',
    gridTemplateColumns: 'minmax(80px, 120px) 1fr minmax(80px, 120px)',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  soundTile: {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid rgba(13, 138, 132, 0.18)',
    backgroundColor: 'var(--color-primary-softer)',
    textAlign: 'center',
    fontFamily: 'var(--font-display)',
    color: 'var(--color-primary-dark)',
    fontSize: '1.25rem',
    fontWeight: '800',
  },
  railLine: {
    height: '8px',
    borderRadius: '999px',
    background: 'linear-gradient(90deg, rgba(13,138,132,0.18), rgba(13,138,132,0.45))',
    position: 'relative',
  },
  blendBadge: {
    position: 'absolute',
    top: '-18px',
    left: '50%',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
  },
  vowels: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  blendWord: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.4rem',
    fontWeight: '800',
    color: 'var(--color-primary-dark)',
  },
})

interface Props {
  scenarioName?: string | null
  metadata?: Partial<ExerciseMetadata>
  attempts: number
  onActiveBlendChange?: (blend: string) => void
  onSendMessage?: (text: string) => void
  /** PR12b.3c — mic-mode preference. Accepted for future conversational-turn wiring; today prop-only. */
  micMode?: MicMode
}

const DEFAULT_VOWELS = ['a', 'ee', 'eye', 'oo']

export function VowelBlendingPanel({ scenarioName, metadata, attempts, onActiveBlendChange, onSendMessage, micMode: _micMode = 'tap' }: Props) {
  const styles = useStyles()
  const targetSound = metadata?.targetSound || 's'
  const cueImage = metadata?.imageAssets?.[0]
  const targets = useMemo(() => {
    return metadata?.targetWords?.length
      ? metadata.targetWords
      : DEFAULT_VOWELS.map(vowel => `${targetSound}${vowel}`)
  }, [metadata?.targetWords, targetSound])
  const vowels = useMemo(() => {
    return targets.map(word => word.replace(new RegExp(`^${targetSound}`, 'i'), '') || word)
  }, [targetSound, targets])
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
    if (targets[0]) {
      onActiveBlendChange?.(targets[0])
    }
  }, [onActiveBlendChange, targets])

  const selectedVowel = vowels[selectedIndex] || vowels[0] || ''
  const blendWord = targets[selectedIndex] || `${targetSound}${selectedVowel}`

  const handleSelect = (index: number) => {
    setSelectedIndex(index)
    const selectedBlend = targets[index]
    if (!selectedBlend) {
      return
    }

    onActiveBlendChange?.(selectedBlend)
    onSendMessage?.(`I chose the blend ${selectedBlend}.`)
  }

  return (
    <Card className={styles.card}>
      <Text className={styles.title}>{scenarioName || 'Vowel blending'}</Text>
      <Text className={styles.body}>
        Slide the sound and the vowel together in your mind, then say the blend smoothly.
      </Text>
      <RepetitionCounter current={attempts} target={metadata?.repetitionTarget} label="Blend tries" />
      {cueImage ? (
        <div className={styles.cueWrap}>
          <div className={styles.cueImageFrame}>
            <img
              className={styles.cueImage}
              src={getImageAssetUrl(cueImage)}
              alt={`${targetSound} cue`}
              loading="lazy"
            />
          </div>
          <Text className={styles.body}>
            Start with the cue sound, then slide into the vowel without breaking the sound apart.
          </Text>
        </div>
      ) : null}
      <div className={styles.rail}>
        <div className={styles.soundTile}>{targetSound}</div>
        <div className={styles.railLine}>
          <Badge appearance="filled" className={styles.blendBadge}>
            blend together
          </Badge>
        </div>
        <div className={styles.soundTile}>{selectedVowel}</div>
      </div>
      <Text className={styles.blendWord}>{blendWord}</Text>
      <div className={styles.vowels}>
        {vowels.map((vowel, index) => (
          <Button
            key={`${targets[index] || targetSound}-${vowel}`}
            appearance={index === selectedIndex ? 'primary' : 'secondary'}
            onClick={() => handleSelect(index)}
          >
            {vowel}
          </Button>
        ))}
      </div>
    </Card>
  )
}