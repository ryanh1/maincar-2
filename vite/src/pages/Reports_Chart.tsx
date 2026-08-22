import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_REPORT_CHART, buildReportChartOption, REPORT_CHART_COLORS, type ReportChartTheme } from '@/lib/reportChart'
import type { ReportChartColor, ReportChartType, ReportConfig, RunReportResponse } from '@/lib/reportTypes'
import { createECharts } from '@/dependencies/echarts'

interface Props {
  config: ReportConfig
  result: RunReportResponse['report'] | undefined
  onChange: (config: ReportConfig) => void
}

interface ClickPosition { x: number; y: number }

const CHART_TYPES: Array<{ value: ReportChartType; label: string }> = [
  { value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }, { value: 'area', label: 'Area' }, { value: 'pie', label: 'Pie' },
  { value: 'funnel', label: 'Funnel' }, { value: 'heatmap', label: 'Heatmap' }, { value: 'scatter', label: 'Scatter' }, { value: 'kpi', label: 'KPI' },
]

const COLOR_BUTTON_CLASSES: Record<ReportChartColor, string> = {
  'chart-1': 'bg-chart-1 hover:bg-chart-1/90',
  'chart-2': 'bg-chart-2 hover:bg-chart-2/90',
  'chart-3': 'bg-chart-3 hover:bg-chart-3/90',
  'chart-4': 'bg-chart-4 hover:bg-chart-4/90',
}

function chartTheme(): ReportChartTheme {
  const styles = getComputedStyle(document.documentElement)
  return {
    colors: REPORT_CHART_COLORS.map((color) => styles.getPropertyValue(`--${color}`).trim()),
    border: styles.getPropertyValue('--border').trim(),
    text: styles.getPropertyValue('--foreground').trim(),
  }
}

function chartColorLabel(color: ReportChartColor): string {
  return color.replace('chart-', 'chart color ')
}

/** Canvas-rendered report chart with controls anchored to its data and Y axis. */
export function ReportsChart({ config, result, onChange }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<ClickPosition | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)
  const chart = config.chart ?? DEFAULT_REPORT_CHART

  function updateChart(next: Partial<typeof chart>): void {
    onChange({ ...config, chart: { ...chart, ...next } })
  }

  useEffect(() => {
    if (!element.current || !result) return
    const instance = createECharts(element.current)
    instance.setOption(buildReportChartOption({ ...config, chart }, result, chartTheme()))
    const openToolbar = (x?: number, y?: number) => setToolbar({ x: x ?? 40, y: y ?? 40 })
    instance.on('click', (event) => openToolbar(event.event?.offsetX, event.event?.offsetY))
    // ECharts only emits its semantic click event for marks. The renderer click
    // keeps the same nearby controls available when a data label has been
    // thinned or the user lands in the series' visual area between marks.
    instance.getZr().on('click', (event) => openToolbar(event.offsetX, event.offsetY))
    const resize = () => instance.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); instance.dispose() }
  }, [chart, config, result, themeVersion])

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  if (!result) return <div className="h-80 animate-pulse rounded-md bg-secondary" aria-label="Loading chart" />
  if (result.rows.length === 0) return <p className="text-sm text-muted-foreground">No Deals match this chart.</p>

  return (
    <div className="relative h-80 rounded-md border border-border bg-background">
      <div ref={element} className="h-full w-full" aria-label="Report chart" />
      {chart.type !== 'kpi' && (
        <Popover>
          <PopoverTrigger asChild><Button type="button" size="xs" variant="secondary" className="absolute top-1/2 left-1 -translate-y-1/2" aria-label="Edit Y axis">Y axis</Button></PopoverTrigger>
          <PopoverContent align="start" side="right" className="w-56">
            <p className="text-sm font-medium">Y axis</p>
            <label className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="chart-axis-max">Maximum value
              <Input id="chart-axis-max" className="h-8" type="number" min="0" value={chart.yAxisMax ?? ''} onChange={(event) => updateChart({ yAxisMax: event.target.value === '' ? undefined : Number(event.target.value) })} />
            </label>
          </PopoverContent>
        </Popover>
      )}
      {toolbar && (
        <div className="absolute z-10 flex items-center gap-2 rounded-md border border-border bg-popover p-2 shadow-md" role="toolbar" aria-label="Series controls" style={{ left: toolbar.x, top: toolbar.y }}>
          <Select value={chart.type} onValueChange={(value) => updateChart({ type: value as ReportChartType })}>
            <SelectTrigger size="sm" aria-label="Chart type"><SelectValue /></SelectTrigger>
            <SelectContent>{CHART_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="chart-labels">Labels
            <Switch id="chart-labels" size="sm" checked={chart.labels} onCheckedChange={(labels) => updateChart({ labels })} />
          </label>
          <div className="flex items-center gap-1" aria-label="Series color">
            {REPORT_CHART_COLORS.map((color) => <IconButton key={color} type="button" size="icon-xs" tooltip={`Use ${chartColorLabel(color)} for this series`} className={`${COLOR_BUTTON_CLASSES[color]} ${chart.color === color ? 'ring-2 ring-ring' : ''}`} onClick={() => updateChart({ color })}><span className="sr-only">{chartColorLabel(color)}</span></IconButton>)}
          </div>
        </div>
      )}
    </div>
  )
}
