import { describe, expect, it } from 'vitest'
import { normalizeAnswer } from '../components/DiagnosticPanel'

describe('normalizeAnswer (#10)', () => {
  it('strips a leading variable assignment', () => {
    expect(normalizeAnswer('x = 5')).toBe('5')
    expect(normalizeAnswer('y= 12')).toBe('12')
    expect(normalizeAnswer('answer = 3/4')).toBe('3/4')
  })

  it('collapses and trims whitespace', () => {
    expect(normalizeAnswer('  3   x  +  2 ')).toBe('3 x + 2')
  })

  it('leaves a bare value unchanged', () => {
    expect(normalizeAnswer('32')).toBe('32')
    expect(normalizeAnswer('Lagos')).toBe('Lagos')
  })

  it('does not strip an equation that is the answer itself', () => {
    // No leading "<symbol> =" prefix, so nothing is stripped.
    expect(normalizeAnswer('2 + 2 = 4')).toBe('2 + 2 = 4')
  })
})
