import { describe, expect, it } from 'vitest'

import { getCuratedIsolatedPreviewAsset } from './isolatedPhonemeAssets'

describe('getCuratedIsolatedPreviewAsset', () => {
  it('returns the approved TH sample asset', () => {
    expect(getCuratedIsolatedPreviewAsset('th')).toEqual({
      sound: 'th',
      audioUrl: '/audio/phonemes/th/curated-th-v1.mp3',
      metadataUrl: '/audio/phonemes/th/curated-th-v1.json',
      label: 'Curated sample asset',
    })
  })

  it('returns null for sounds without an approved sample asset', () => {
    expect(getCuratedIsolatedPreviewAsset('f')).toBeNull()
    expect(getCuratedIsolatedPreviewAsset(undefined)).toBeNull()
  })
})