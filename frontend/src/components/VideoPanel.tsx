/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Text, makeStyles, tokens } from '@fluentui/react-components'
import { useMemo, useState } from 'react'
import type React from 'react'
import { AVATAR_OPTIONS } from '../types'
import { BuddyAvatar } from './BuddyAvatar'

const useStyles = makeStyles({
  card: {
    width: '100%',
    maxWidth: '400px',
    height: '100%',
    padding: tokens.spacingVerticalS,
    alignSelf: 'center',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-card)',
    boxShadow: 'var(--shadow-sm)',
    '@media (max-width: 1080px)': {
      maxWidth: '100%',
    },
  },
  videoContainer: {
    width: '100%',
    aspectRatio: '3 / 4',
    background:
      'radial-gradient(circle at top, rgba(13, 138, 132, 0.18), transparent 34%), radial-gradient(circle at bottom, rgba(212, 143, 75, 0.14), transparent 36%), linear-gradient(180deg, rgba(244, 247, 248, 0.96), rgba(240, 245, 247, 0.94))',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    position: 'relative',
    display: 'grid',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  introOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    alignContent: 'space-between',
    justifyItems: 'center',
    padding: 'var(--space-lg)',
    textAlign: 'center',
    gap: 'var(--space-md)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))',
  },
  introBadge: {
    justifySelf: 'start',
    backgroundColor: 'rgba(255,255,255,0.85)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.14)',
  },
  buddyAvatarWrap: {
    filter: 'drop-shadow(0 24px 40px rgba(13, 138, 132, 0.22))',
    animationName: {
      '0%': { transform: 'scale(1)' },
      '50%': { transform: 'scale(1.06)' },
      '100%': { transform: 'scale(1)' },
    },
    animationDuration: '2.4s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  introCopy: {
    display: 'grid',
    gap: 'var(--space-xs)',
    maxWidth: '280px',
  },
  introTitle: {
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontSize: '1.15rem',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  introText: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
    fontSize: '0.875rem',
  },
  promptCard: {
    width: '100%',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    boxShadow: 'var(--shadow-sm)',
    display: 'grid',
    gap: '4px',
  },
  promptLabel: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  promptText: {
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    lineHeight: 1.55,
  },
})

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  childName?: string | null
  avatarValue?: string
  scenarioName?: string | null
  scenarioDescription?: string | null
  connectionState?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  introPending?: boolean
  introComplete?: boolean
  onVideoLoaded?: () => void
}

function markVideoReady(
  videoKey: string,
  setLoadedVideoKey: (value: string) => void,
  onVideoLoaded?: () => void
) {
  setLoadedVideoKey(videoKey)
  onVideoLoaded?.()
}

export function VideoPanel({
  videoRef,
  childName,
  avatarValue,
  scenarioName,
  scenarioDescription,
  connectionState = 'connecting',
  introPending = false,
  introComplete = true,
  onVideoLoaded,
}: Props) {
  const styles = useStyles()
  const videoKey = `${avatarValue || 'avatar'}-${childName || 'child'}-${scenarioName || 'scenario'}`
  const [loadedVideoKey, setLoadedVideoKey] = useState<string | null>(null)
  const hasVideo = loadedVideoKey === videoKey

  const avatarLabel = useMemo(() => {
    return (
      AVATAR_OPTIONS.find(option => option.value === avatarValue)?.label ||
      'Practice buddy'
    )
  }, [avatarValue])

  const avatarName = avatarLabel.split(' (')[0]
  const childLabel = childName || 'friend'
  const exerciseLabel = scenarioName || 'today\'s practice'
  const promptText =
    scenarioDescription ||
    `We are going to practise ${exerciseLabel} together. Tap to talk when you are ready.`
  const statusLabel =
    connectionState === 'connected'
      ? introPending
        ? `${avatarName} is welcoming ${childLabel}.`
        : introComplete
          ? `${avatarName} is ready to begin.`
          : `${avatarName} is getting ready.`
      : `${avatarName} is getting ready for ${childLabel}.`

  return (
    <Card className={styles.card}>
      <div className={styles.videoContainer}>
        <video
          key={videoKey}
          ref={videoRef}
          className={styles.video}
          autoPlay
          playsInline
          onLoadedMetadata={() => markVideoReady(videoKey, setLoadedVideoKey, onVideoLoaded)}
          onCanPlay={() => markVideoReady(videoKey, setLoadedVideoKey, onVideoLoaded)}
          onLoadedData={() => {
            markVideoReady(videoKey, setLoadedVideoKey, onVideoLoaded)
          }}
          onPlaying={() => markVideoReady(videoKey, setLoadedVideoKey, onVideoLoaded)}
        >
          <track
            kind="captions"
            src="data:text/vtt,WEBVTT"
            srcLang="en"
            label="English captions"
            default
          />
        </video>

        {!hasVideo ? (
          <div className={styles.introOverlay}>
            <Badge appearance="filled" className={styles.introBadge}>
              {statusLabel}
            </Badge>

            <div className={styles.buddyAvatarWrap}>
              <BuddyAvatar avatarValue={avatarValue || ''} size={140} />
            </div>

            <div className={styles.introCopy}>
              <Text className={styles.introTitle}>
                {introPending
                  ? `${avatarName} is saying hello to ${childLabel}.`
                  : `${avatarName} is ready for ${exerciseLabel}.`}
              </Text>
              <Text className={styles.introText}>
                {introPending
                  ? 'Listen for the welcome and watch for the microphone to unlock.'
                  : introComplete
                    ? 'The session is ready. Tap the microphone when you want to talk.'
                    : 'Your buddy is getting set up for a calm, friendly practice turn.'}
              </Text>
            </div>

            <div className={styles.promptCard}>
              <Text className={styles.promptLabel}>Today&apos;s practice</Text>
              <Text className={styles.promptText}>{promptText}</Text>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
