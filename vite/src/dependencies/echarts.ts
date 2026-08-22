import { init, use as registerECharts, type ECharts } from 'echarts/core'
import { BarChart, FunnelChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'

registerECharts([BarChart, FunnelChart, HeatmapChart, LineChart, PieChart, ScatterChart, CanvasRenderer, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent])

/** The only ECharts setup point: canvas renderer plus the chart modules Reports supports. */
export function createECharts(element: HTMLDivElement): ECharts {
  return init(element, undefined, { renderer: 'canvas' })
}
