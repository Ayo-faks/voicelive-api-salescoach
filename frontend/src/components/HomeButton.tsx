/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Text,
  makeStyles,
} from '@fluentui/react-components'
import { HomeRegular } from '@fluentui/react-icons'
import { useCallback, useState } from 'react'

const useStyles = makeStyles({
  confirmBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
    paddingTop: 'var(--space-sm)',
    paddingBottom: 'var(--space-sm)',
  },
})

interface HomeButtonProps {
  isSessionActive: boolean
  onGoHome: () => void
}

export function HomeButton({ isSessionActive, onGoHome }: HomeButtonProps) {
  const styles = useStyles()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleClick = useCallback(() => {
    if (isSessionActive) {
      setConfirmOpen(true)
    } else {
      onGoHome()
    }
  }, [isSessionActive, onGoHome])

  const handleConfirm = useCallback(() => {
    setConfirmOpen(false)
    onGoHome()
  }, [onGoHome])

  return (
    <>
      <Button
        appearance="subtle"
        icon={<HomeRegular />}
        onClick={handleClick}
      >
        Home
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(_, data) => setConfirmOpen(data.open)}>
        <DialogSurface>
          <DialogTitle>Leave this session?</DialogTitle>
          <DialogBody>
            <div className={styles.confirmBody}>
              <Text size={300}>
                The current session has unsaved progress. Returning home will
                end the session and any unanalysed practice will be lost.
              </Text>
            </div>
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setConfirmOpen(false)}>
              Stay in session
            </Button>
            <Button appearance="primary" onClick={handleConfirm}>
              Return home
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>
    </>
  )
}
