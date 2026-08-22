import type { EChartsOption } from 'echarts'

import type { DealPivotDimension, ReportChartConfig, ReportChartColor, ReportConfig, RunReportResponse } from './reportTypes'

export const DEFAULT_REPORT_CHART: ReportChartConfig = { type: 'bar', color: 'chart-1', labels: false }
export const REPORT_CHART_COLORS: ReportChartColor[] = ['chart-1', 'chart-2', 'chart-3', 'chart-4']

export interface ReportChartTheme {
  colors: string[]
  border: string
  text: string
}

interface ChartPoint {
  label: string
  series: string
  amount: number
}

function fieldLabel(row: RunReportResponse['report']['rows'][number], field: DealPivotDimension): string {
  if (field === 'createdAt') return row.createdDay ?? 'Unknown date'
  return String(row[`${field}Name`] ?? 'Unassigned')
}

function pointsFor(config: ReportConfig, result: RunReportResponse['report']): ChartPoint[] {
  const primary = config.rows[0]?.field ?? config.columns[0]?.field
  if (!primary) return []
  const breakout = config.rows.length > 0 ? config.columns[0]?.field : undefined
  return result.rows.map((row) => ({
    label: fieldLabel(row, primary),
    series: breakout ? fieldLabel(row, breakout) : 'Amount',
    amount: Number(BigInt(row.amountMinor ?? '0')) / 100,
  }))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function groupedValues(points: ChartPoint[], labels: string[], series: string[]): Array<{ name: string; values: number[] }> {
  return series.map((seriesName) => ({
    name: seriesName,
    values: labels.map((label) => points
      .filter((point) => point.label === label && point.series === seriesName)
      .reduce((total, point) => total + point.amount, 0)),
  }))
}

function amountLabel(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatChartValue(value: unknown): string {
  const numeric = Array.isArray(value) ? value.at(-1) : value
  return amountLabel(Number(numeric ?? 0))
}

export function buildReportChartOption(config: ReportConfig, result: RunReportResponse['report'], theme: ReportChartTheme): EChartsOption {
  const chart = config.chart ?? DEFAULT_REPORT_CHART
  const points = pointsFor(config, result)
  const labels = unique(points.map((point) => point.label))
  const seriesNames = unique(points.map((point) => point.series))
  const seriesValues = groupedValues(points, labels, seriesNames)
  const shared = {
    animation: false,
    color: theme.colors,
    textStyle: { color: theme.text },
    tooltip: { trigger: 'axis' as const, valueFormatter: formatChartValue },
    legend: seriesNames.length > 1 ? { show: true } : { show: false },
    grid: { top: 24, right: 24, bottom: 36, left: 72 },
  }
  const label = { show: chart.labels, formatter: ({ value }: { value?: unknown }) => formatChartValue(value) }

  if (chart.type === 'kpi') {
    return {
      animation: false,
      title: { text: amountLabel(points.reduce((total, point) => total + point.amount, 0)), left: 'center', top: 'middle', textStyle: { fontSize: 28, fontWeight: 500 } },
    }
  }
  if (chart.type === 'pie') {
    const data = labels.map((name) => ({ name, value: points.filter((point) => point.label === name).reduce((total, point) => total + point.amount, 0) }))
    return {
      animation: false,
      color: theme.colors,
      tooltip: { trigger: 'item', valueFormatter: formatChartValue },
      series: [{ type: 'pie', data, label, radius: ['35%', '70%'] }],
    }
  }
  if (chart.type === 'funnel') {
    const data = labels.map((name) => ({ name, value: points.filter((point) => point.label === name).reduce((total, point) => total + point.amount, 0) }))
    return {
      animation: false,
      color: theme.colors,
      tooltip: { trigger: 'item', valueFormatter: formatChartValue },
      series: [{ type: 'funnel', data, label }],
    }
  }
  if (chart.type === 'heatmap') {
    return {
      ...shared,
      xAxis: { type: 'category', data: labels, splitArea: { show: true }, axisLabel: { color: theme.text }, splitLine: { lineStyle: { color: theme.border } } },
      yAxis: { type: 'category', data: seriesNames, splitArea: { show: true }, axisLabel: { color: theme.text }, splitLine: { lineStyle: { color: theme.border } } },
      visualMap: { min: 0, max: Math.max(...points.map((point) => point.amount), 0), calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [{ type: 'heatmap', data: points.map((point) => [labels.indexOf(point.label), seriesNames.indexOf(point.series), point.amount]), label }],
    }
  }
  if (chart.type === 'scatter') {
    return {
      ...shared,
      xAxis: { type: 'value', axisLabel: { color: theme.text, formatter: (value: number) => labels[value] ?? '' }, min: 0, max: Math.max(labels.length - 1, 1), splitLine: { lineStyle: { color: theme.border } } },
      yAxis: { type: 'value', name: 'Amount', max: chart.yAxisMax, nameTextStyle: { color: theme.text }, axisLabel: { color: theme.text, formatter: amountLabel }, splitLine: { lineStyle: { color: theme.border } } },
      series: seriesValues.map(({ name, values }) => ({ type: 'scatter', name, data: values.map((value, index) => [index, value]), label, large: true })),
    }
  }
  if (chart.type === 'bar') return {
    ...shared,
    xAxis: { type: 'category', data: labels, axisLabel: { color: theme.text }, axisLine: { lineStyle: { color: theme.border } } },
    yAxis: { type: 'value', name: 'Amount', max: chart.yAxisMax, nameTextStyle: { color: theme.text }, axisLabel: { color: theme.text, formatter: amountLabel }, splitLine: { lineStyle: { color: theme.border } } },
    series: seriesValues.map(({ name, values }) => ({ type: 'bar', name, data: values, label })),
  }
  return {
    ...shared,
    xAxis: { type: 'category', data: labels, axisLabel: { color: theme.text }, axisLine: { lineStyle: { color: theme.border } } },
    yAxis: { type: 'value', name: 'Amount', max: chart.yAxisMax, nameTextStyle: { color: theme.text }, axisLabel: { color: theme.text, formatter: amountLabel }, splitLine: { lineStyle: { color: theme.border } } },
    series: seriesValues.map(({ name, values }) => ({ type: 'line', name, data: values, label, ...(chart.type === 'area' ? { areaStyle: {} } : {}) })),
  }
}
