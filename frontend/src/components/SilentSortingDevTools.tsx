/*---------------------------------------------------------------------------------------------
 *  SilentSortingDevTools — dev-only Save-take drawer for the silent-sorting adapter.
 *  Extracted from SilentSortingPanel per plan §C.6. Rendered via ExerciseShell's
 *  `devSlot` prop. Returns null (renders nothing) unless
 *  `isPreviewExportEnabled()` is true — gate preserved exactly from the panel.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles } from '@fluentui/react-components'
import { useCallback, type FC } from 'react'
import { exportPreviewTake, isPreviewExportEnabled } from '../dev/previewExport'
import { api } from '../services/api'
import { buildPreviewCandidate, type PreviewStrategyFamily } from '../utils/phonemeSsml'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-xs)',
    alignItems: 'center',
  },
  button: {
    minHeight: '30px',
    borderRadius: '0px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
  },
  status: {
    fontSize: '0.78rem',
    color: 'var(--color-text-secondary)',
    fontWeight: '600',
  },
})

export interface SilentSortingDevToolsProps {
  lastPreviewed: {
    sound: string
    bucket: 'target' | 'error'
    source: 'asset' | 'tts'
  } | null
  previewStrategy: PreviewStrategyFamily
  previewPending: boolean
  exportStatus: string | null
  onStatusChange: (status: string | null) => void
  onPendingChange: (pending: boolean) => void
}

export const SilentSortingDevTools: FC<SilentSortingDevToolsProps> = ({
  lastPreviewed,
  previewStrategy,
  previewPending,
  exportStatus,
  onStatusChange,
  onPendingChange,
}) => {
  const styles = useStyles()

  const handleSaveLastTake = useCallback(async () => {
    if (!lastPreviewed || previewPending || lastPreviewed.source === 'asset') {
      return
    }
    const candidate = buildPreviewCandidate(lastPreviewed.sound, previewStrategy)
    if (!candidate) {
      onStatusChange('Save failed: no candidate')
      return
    }
    onPendingChange(true)
    onStatusChange('Saving...')
    try {
      const audioBase64 = await api.synthesizeSpeech(candidate.input)
      const result = exportPreviewTake({
        sound: lastPreviewed.sound,
        bucket: lastPreviewed.bucket,
        strategy: previewStrategy,
        candidate,
        audioBase64,
      })
      onStatusChange(`Saved ${result.audioFilename}`)
    } catch {
      onStatusChange('Save failed')
    } finally {
      onPendingChange(false)
    }
  }, [lastPreviewed, onPendingChange, onStatusChange, previewPending, previewStrategy])

  if (!isPreviewExportEnabled()) {
    return null
  }

  const disabled =
    previewPending || !lastPreviewed || lastPreviewed.source === 'asset'

  return (
    <div className={styles.root} data-testid="silent-sorting-dev-tools">
      <Button
        appearance="secondary"
        className={styles.button}
        disabled={disabled}
        onClick={() => void handleSaveLastTake()}
        title={
          lastPreviewed?.source === 'asset'
            ? 'This sound already uses the approved sample asset'
            : lastPreviewed
              ? undefined
              : 'Preview a sound first'
        }
      >
        Save take
      </Button>
      {exportStatus ? (
        <Text className={styles.status}>{exportStatus}</Text>
      ) : null}
    </div>
  )
}

export default SilentSortingDevTools
