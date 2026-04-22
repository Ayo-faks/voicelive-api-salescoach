import { describe, expect, it } from 'vitest'

import { getDrillModelToken, normalizeStreamingDrillText, replaceDrillTokens } from './drillTokens'

describe('drillTokens', () => {
  it('replaces deterministic drill tokens with child-friendly text', () => {
    expect(replaceDrillTokens('Listen first. R_RAH_MODEL. Your turn.')).toBe(
      'Listen first. rrr-ah, rah. Your turn.',
    )
    expect(replaceDrillTokens('Try R_ROO_MODEL then R_ROW_MODEL.')).toBe(
      'Try rrr-oo, roo then rrr-oh, row.',
    )
  })

  it('replaces K drill tokens', () => {
    expect(replaceDrillTokens('Listen first. K_COO_MODEL. Your turn.')).toBe(
      'Listen first. k-oo, coo. Your turn.',
    )
    expect(replaceDrillTokens('Try K_KEY_MODEL then K_COW_MODEL.')).toBe(
      'Try k-ee, key then k-ow, cow.',
    )
  })

  it('replaces S drill tokens', () => {
    expect(replaceDrillTokens('Listen first. S_SUE_MODEL. Your turn.')).toBe(
      'Listen first. sss-oo, sue. Your turn.',
    )
  })

  it('replaces SH drill tokens', () => {
    expect(replaceDrillTokens('Listen first. SH_SHOE_MODEL. Your turn.')).toBe(
      'Listen first. sh-oo, shoe. Your turn.',
    )
  })

  it('replaces TH drill tokens', () => {
    expect(replaceDrillTokens('Listen first. TH_THOO_MODEL. Your turn.')).toBe(
      'Listen first. th-oo, thoo. Your turn.',
    )
    expect(replaceDrillTokens('Try TH_THEE_MODEL then TH_THIGH_MODEL.')).toBe(
      'Try th-ee, thee then th-eye, thigh.',
    )
    expect(replaceDrillTokens('Listen first. TH_THIN_MODEL then F_FIN_MODEL.')).toBe(
      'Listen first. th-in, thin then fff-in, fin.',
    )
  })

  it('maps known drill words back to their model tokens', () => {
    expect(getDrillModelToken('thin')).toBe('TH_THIN_MODEL')
    expect(getDrillModelToken('thorn')).toBe('TH_THORN_MODEL')
    expect(getDrillModelToken('fin')).toBe('F_FIN_MODEL')
    expect(getDrillModelToken('rah')).toBe('R_RAH_MODEL')
    expect(getDrillModelToken('unknown')).toBe('unknown')
  })

  it('leaves non-token text unchanged', () => {
    expect(replaceDrillTokens('Start with your rocket sound.')).toBe(
      'Start with your rocket sound.',
    )
  })

  it('hides partial token fragments while assistant text is still streaming', () => {
    expect(normalizeStreamingDrillText('Listen first. R_R')).toBe('Listen first. ')
    expect(normalizeStreamingDrillText('Listen first. R_RAH_MODEL')).toBe(
      'Listen first. rrr-ah, rah',
    )
    expect(normalizeStreamingDrillText('Listen first. R_RAH_MODEL. Try rah again.')).toBe(
      'Listen first. rrr-ah, rah. Try rah again.',
    )
  })

  it('hides partial K/S/SH/TH token fragments while streaming', () => {
    expect(normalizeStreamingDrillText('Listen first. K_K')).toBe('Listen first. ')
    expect(normalizeStreamingDrillText('Listen first. K_KEY_MODEL')).toBe(
      'Listen first. k-ee, key',
    )
    expect(normalizeStreamingDrillText('Listen first. SH_SH')).toBe('Listen first. ')
    expect(normalizeStreamingDrillText('Listen first. SH_SHOE_MODEL')).toBe(
      'Listen first. sh-oo, shoe',
    )
    expect(normalizeStreamingDrillText('Listen first. TH_THOU')).toBe('Listen first. ')
    expect(normalizeStreamingDrillText('Listen first. TH_THOUGH_MODEL')).toBe(
      'Listen first. th-oh, though',
    )
  })
})