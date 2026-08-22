import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { ReportConfig, RunReportResponse } from '@/lib/reportTypes'

const { chartRendererMock, chartSurfaceClickMock } = vi.hoisted(() => ({
  chartRendererMock: vi.fn(),
  chartSurfaceClickMock: vi.fn(),
}))

vi.mock('@/dependencies/echarts', () => ({
  createECharts: () => ({ dispose: vi.fn(), getZr: () => ({ on: chartSurfaceClickMock }), on: vi.fn(), resize: vi.fn(), setOption: chartRendererMock }),
}))

import { ReportsChart } from './Reports_Chart'

const config: ReportConfig = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  columns: [],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  timeZone: { mode: 'viewer' },
  chart: { type: 'bar', color: 'chart-1', labels: false },
}

const result: RunReportResponse['report'] = {
  rows: [
    { stageId: 'discovery', stageName: 'Discovery', amountMinor: '3500' },
    { stageId: 'won', stageName: 'Won', amountMinor: '1500' },
  ],
}

describe('ReportsChart', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a chart surface for a runnable pivot result', () => {
    render(<TooltipProvider><ReportsChart config={config} result={result} onChange={vi.fn()} /></TooltipProvider>)

    expect(screen.getByLabelText('Report chart')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Y axis' })).toBeInTheDocument()
  })

  it('changes a series color from the chart surface', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TooltipProvider><ReportsChart config={config} result={result} onChange={onChange} /></TooltipProvider>)

    await act(async () => chartSurfaceClickMock.mock.calls[0][1]({ offsetX: 120, offsetY: 80 }))
    await user.click(screen.getByRole('button', { name: 'Use chart color 2 for this series' }))

    expect(onChange).toHaveBeenCalledWith({
      ...config,
      chart: { ...config.chart, color: 'chart-2' },
    })
  })
})
