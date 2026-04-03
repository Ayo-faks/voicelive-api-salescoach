/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Text, makeStyles, mergeClasses } from '@fluentui/react-components'
import { getImageAssetUrl } from '../services/api'

const useStyles = makeStyles({
  card: {
    display: 'grid',
    gap: '10px',
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid rgba(13, 138, 132, 0.12)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(240, 250, 248, 0.96))',
    boxShadow: '0 14px 30px rgba(13, 138, 132, 0.08)',
    cursor: 'default',
  },
  selected: {
    border: '1px solid var(--color-primary)',
    boxShadow: '0 14px 30px rgba(13, 138, 132, 0.16)',
  },
  interactive: {
    cursor: 'pointer',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
    borderRadius: '0px',
    backgroundColor: '#B2DFDB',
    display: 'grid',
    placeItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  fallback: {
    fontFamily: 'var(--font-display)',
    fontSize: '2rem',
    fontWeight: '700',
    color: 'var(--color-primary-dark)',
  },
  label: {
    textAlign: 'center',
    fontFamily: 'var(--font-display)',
    color: 'var(--color-text-primary)',
    fontWeight: '700',
    fontSize: '0.9rem',
  },
})

interface Props {
  word: string
  imagePath?: string
  selected?: boolean
  onClick?: () => void
}

export function ImageCard({ word, imagePath, selected = false, onClick }: Props) {
  const styles = useStyles()

  return (
    <Card
      className={mergeClasses(
        styles.card,
        selected && styles.selected,
        onClick && styles.interactive
      )}
      onClick={onClick}
    >
      <div className={styles.imageWrap}>
        {imagePath ? (
          <img className={styles.image} src={getImageAssetUrl(imagePath)} alt={word} loading="lazy" />
        ) : (
          <Text className={styles.fallback}>{word.charAt(0).toUpperCase()}</Text>
        )}
      </div>
      <Text className={styles.label}>{word}</Text>
    </Card>
  )
}