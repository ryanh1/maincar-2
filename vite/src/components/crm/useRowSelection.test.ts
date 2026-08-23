import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRowSelection } from './useRowSelection'

describe('useRowSelection', () => {
  it('selects a shift-clicked inclusive range without materializing the full filtered set', () => {
    const { result } = renderHook(() => useRowSelection(['record-1', 'record-2', 'record-3', 'record-4'], 100))

    act(() => result.current.toggle('record-2'))
    act(() => result.current.toggle('record-4', true))

    expect(result.current.selectedIds).toEqual(new Set(['record-2', 'record-3', 'record-4']))
    expect(result.current.selectedCount).toBe(3)
    expect(result.current.allInFilter).toBe(false)
  })

  it('selects loaded rows, then extends selection to the complete filter and clears it', () => {
    const { result } = renderHook(() => useRowSelection(['record-1', 'record-2', 'record-3'], 100))

    act(() => result.current.toggleLoaded())
    expect(result.current.selectedIds).toEqual(new Set(['record-1', 'record-2', 'record-3']))
    expect(result.current.shouldOfferSelectAll).toBe(true)

    act(() => result.current.selectAllInFilter())
    expect(result.current.allInFilter).toBe(true)
    expect(result.current.selectedCount).toBe(100)
    expect(result.current.selectedIds.size).toBe(0)

    act(() => result.current.clear())
    expect(result.current.selectedCount).toBe(0)
    expect(result.current.allInFilter).toBe(false)
  })
})
