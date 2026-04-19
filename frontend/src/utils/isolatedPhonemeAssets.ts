export interface CuratedIsolatedPreviewAsset {
  sound: string
  audioUrl: string
  metadataUrl: string
  label: string
}

const CURATED_ISOLATED_PREVIEW_ASSETS: Readonly<Record<string, CuratedIsolatedPreviewAsset>> = Object.freeze({
  th: {
    sound: 'th',
    audioUrl: '/audio/phonemes/th/curated-th-v1.mp3',
    metadataUrl: '/audio/phonemes/th/curated-th-v1.json',
    label: 'Curated sample asset',
  },
})

export function getCuratedIsolatedPreviewAsset(
  sound: string | null | undefined,
): CuratedIsolatedPreviewAsset | null {
  if (!sound) {
    return null
  }

  return CURATED_ISOLATED_PREVIEW_ASSETS[sound.trim().toLowerCase()] ?? null
}