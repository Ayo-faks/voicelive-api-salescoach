/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Text, makeStyles } from '@fluentui/react-components'

const useStyles = makeStyles({
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  label: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.82rem',
  },
  badge: {
    backgroundColor: 'var(--color-primary-soft)',
    color: 'var(--color-primary-dark)',
  },
})

interface Props {
  current: number
  target?: number
  label?: string
}

export function RepetitionCounter({ current, target, label = 'Practice count' }: Props) {
  const styles = useStyles()
  return (
    <div className={styles.wrap}>
      <Text className={styles.label}>{label}</Text>
      <Badge appearance="filled" className={styles.badge}>
        {target ? `${Math.min(current, target)} / ${target}` : current}
      </Badge>
    </div>
  )
}