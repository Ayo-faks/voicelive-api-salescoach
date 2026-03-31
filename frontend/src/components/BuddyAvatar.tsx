/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components'

const useStyles = makeStyles({
  wrapper: {
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  robot: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
})

interface Props {
  avatarValue: string
  /** Pixel size for width & height */
  size?: number
}
export function BuddyAvatar({ avatarValue: _avatarValue, size = 140 }: Props) {
  const styles = useStyles()

  return (
    <div className={styles.wrapper} style={{ width: size, height: size }}>
      <img
        src="/wulo-robot.webp"
        alt="Wulo robot buddy"
        className={styles.robot}
      />
    </div>
  )
}
