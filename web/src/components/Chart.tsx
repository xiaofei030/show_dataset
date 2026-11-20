import ReactECharts from 'echarts-for-react'

export default function Chart({ option, height = 300 }: { option: Record<string, unknown>; height?: number }) {
  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export const PALETTE = ['#0f766e', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#64748b', '#db2777']
