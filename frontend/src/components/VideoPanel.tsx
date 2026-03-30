/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Badge,
  Card,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import { MicrophoneIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useMemo, useState } from 'react'
import type React from 'react'
import { AVATAR_OPTIONS } from '../types'
import { BuddyAvatar } from './BuddyAvatar'

const useStyles = makeStyles({
  card: {
    width: '100%',
    maxWidth: '100%',
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
    aspectRatio: '16 / 9',
    background:
      'radial-gradient(circle at top, rgba(13, 138, 132, 0.18), transparent 34%), radial-gradient(circle at bottom, rgba(13, 138, 132, 0.1), transparent 36%), linear-gradient(180deg, rgba(244, 247, 248, 0.96), rgba(232, 243, 244, 0.94))',
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
    paddingBottom: 'calc(var(--space-xl) + 88px)',
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
  micDock: {
    position: 'absolute',
    left: '28px',
    bottom: '28px',
    display: 'grid',
    justifyItems: 'start',
    gap: '10px',
    zIndex: 2,
    width: 'min(100%, 280px)',
    '@media (max-width: 640px)': {
      left: '18px',
      bottom: '18px',
    },
  },
  connectionBadge: {
    position: 'absolute',
    top: '14px',
    right: '14px',
    zIndex: 2,
    maxWidth: 'min(70%, 240px)',
    padding: '6px 10px',
    borderRadius: '999px',
    backgroundColor: 'rgba(255,255,255,0.9)',
    color: 'var(--color-primary-dark)',
    border: '1px solid rgba(13, 138, 132, 0.16)',
    boxShadow: '0 10px 20px rgba(13, 138, 132, 0.12)',
  },
  micButton: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '72px',
    height: '72px',
    minWidth: '72px',
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
    color: 'var(--color-text-inverse)',
    boxShadow: '0 14px 28px rgba(13, 138, 132, 0.22)',
    transition:
      'transform var(--transition-normal), box-shadow var(--transition-normal), background-color var(--transition-normal), opacity var(--transition-normal)',
    '&:hover': {
      transform: 'scale(1.03)',
    },
    '&:active': {
      transform: 'scale(0.97)',
    },
    '&:disabled': {
      opacity: 0.55,
      cursor: 'not-allowed',
      transform: 'none',
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: '-10px',
      borderRadius: '50%',
      border: '2px solid transparent',
      opacity: 0,
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: '-20px',
      borderRadius: '50%',
      border: '2px solid transparent',
      opacity: 0,
    },
    '@media (max-width: 640px)': {
      width: '56px',
      height: '56px',
      minWidth: '56px',
    },
  },
  micIcon: {
    width: '28px',
    height: '28px',
    color: 'var(--color-text-inverse)',
    strokeWidth: '2.2',
    '@media (max-width: 640px)': {
      width: '24px',
      height: '24px',
    },
  },
  micButtonActive: {
    background: 'linear-gradient(135deg, var(--color-primary-dark), var(--color-primary))',
    boxShadow: '0 14px 28px rgba(13, 138, 132, 0.28), 0 0 0 18px rgba(13, 138, 132, 0.08)',
    '&::before': {
      opacity: 1,
      border: '2px solid rgba(13, 138, 132, 0.4)',
      animationName: {
        '0%': { transform: 'scale(0.95)', opacity: 0.6 },
        '100%': { transform: 'scale(1.2)', opacity: 0 },
      },
      animationDuration: '2s',
      animationIterationCount: 'infinite',
    },
    '&::after': {
      opacity: 1,
      border: '2px solid rgba(13, 138, 132, 0.25)',
      animationName: {
        '0%': { transform: 'scale(0.9)', opacity: 0.4 },
        '100%': { transform: 'scale(1.3)', opacity: 0 },
      },
      animationDuration: '2s',
      animationDelay: '0.4s',
      animationIterationCount: 'infinite',
    },
  },
  micLabel: {
    color: 'var(--color-text-inverse)',
    backgroundColor: 'rgba(7, 24, 38, 0.6)',
    borderRadius: '999px',
    padding: '6px 12px',
    backdropFilter: 'blur(10px)',
    boxShadow: '0 10px 20px rgba(7, 24, 38, 0.16)',
    fontSize: '0.78rem',
    fontWeight: '600',
    textAlign: 'center',
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
  sessionFinished?: boolean
  onVideoLoaded?: () => void
  connectionMessage?: string
  recording?: boolean
  processing?: boolean
  onToggleRecording?: () => void | Promise<void>
  canTalk?: boolean
  audience?: 'therapist' | 'child'
  showMicDock?: boolean
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
  sessionFinished = false,
  onVideoLoaded,
  connectionMessage,
  recording = false,
  processing = false,
  onToggleRecording,
  canTalk = false,
  audience = 'child',
  showMicDock = true,
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
    (audience === 'therapist'
      ? `Review ${exerciseLabel} and use the dock microphone when ${childLabel} is ready.`
      : `We are going to practise ${exerciseLabel} together. Tap to talk when you are ready.`)
  const statusLabel =
    sessionFinished && audience === 'child'
      ? `${avatarName} has wrapped up ${childLabel}'s practice.`
      : connectionState === 'connected'
      ? introPending
        ? `${avatarName} is welcoming ${childLabel}.`
        : introComplete
          ? `${avatarName} is ready to begin.`
          : `${avatarName} is getting ready.`
      : `${avatarName} is getting ready for ${childLabel}.`
  const micLabel = recording
    ? 'Listening...'
    : sessionFinished && audience === 'child'
      ? 'Practice finished'
    : processing && audience === 'child'
      ? 'Checking your try...'
    : !introComplete
      ? audience === 'therapist'
        ? 'Welcome in progress'
        : 'Listen to your buddy'
      : audience === 'therapist'
        ? 'Mic ready'
      : 'Tap to talk'
  const statusText =
    sessionFinished && audience === 'child'
      ? 'Practice finished'
      : connectionState === 'connected'
      ? introComplete
        ? 'Voice ready'
        : 'Welcoming...'
      : connectionMessage || 'Connecting...'

  return (
    <Card className={styles.card}>
      <div className={styles.videoContainer}>
        <Badge appearance="filled" className={styles.connectionBadge}>
          {statusText}
        </Badge>
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
                  ? audience === 'therapist'
                    ? `${avatarName} is opening the session for ${childLabel}.`
                    : `${avatarName} is saying hello to ${childLabel}.`
                  : audience === 'therapist'
                    ? `${avatarName} is ready for ${childLabel}.`
                    : `${avatarName} is ready for ${exerciseLabel}.`}
              </Text>
              <Text className={styles.introText}>
                {introPending
                  ? audience === 'therapist'
                    ? 'Listen for the opening welcome. The microphone will unlock as soon as it finishes.'
                    : 'Listen for the welcome and watch for the microphone to unlock.'
                  : audience === 'therapist'
                    ? 'Keep the session moving and open the dock microphone when the child is ready.'
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

        <div className={styles.micDock}>
          <button
            type="button"
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            className={mergeClasses(
              styles.micButton,
              recording && styles.micButtonActive
            )}
            onClick={onToggleRecording}
            disabled={!canTalk || !onToggleRecording}
          >
            {recording ? (
              <XMarkIcon className={styles.micIcon} />
            ) : (
              <MicrophoneIcon className={styles.micIcon} />
            )}
          </button>
          <Text className={styles.micLabel}>{micLabel}</Text>
        </div>
      </div>
    </Card>
  )
}
