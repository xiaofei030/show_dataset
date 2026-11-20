import { useEffect, useMemo, useState } from 'react'
import { Alert, Card, Col, Input, Progress, Row, Spin, Table, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { api, fmtBytes, fmtInt } from '../api'
import Chart from '../components/Chart'
import type { ColumnStat } from '../types'

interface CatalogTable {
  module: 'hosp' | 'icu'
  description: string
  rows: number
  bytes: number
  columns: ColumnStat[]
}
interface Catalog {
  dataset: { table_count: number; column_count: number; total_rows: number; total_bytes: number; root: string; generated_at: string }
  tables: Record<string, CatalogTable>
}

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <Card className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </Card>
  )
}

export default function Quality() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [find, setFind] = useState('')

  useEffect(() => {
    api<Catalog>('/api/quality').then(setCat).catch((err: Error) => setError(err.message))
  }, [])

  const rows = useMemo(() => {
    if (!cat) return []
    const needle = find.trim().toLowerCase()
    return Object.entries(cat.tables)
      .map(([name, t]) => ({ name, ...t }))
      .filter((t) => !needle || t.name.includes(needle) || t.description.toLowerCase().includes(needle))
      .sort((a, b) => b.rows - a.rows)
  }, [cat, find])

  const nullTop = useMemo(() => {
    if (!cat) return []
    const list: { label: string; pct: number; table: string }[] = []
    Object.entries(cat.tables).forEach(([name, t]) => {
      t.columns.forEach((c) => {
        if (c.null_count > 0) list.push({ label: `${name}.${c.name}`, pct: c.null_pct, table: name })
      })
    })
    return list.sort((a, b) => b.pct - a.pct).slice(0, 18)
  }, [cat])

  if (error) return <Alert type="error" showIcon message="加载数据质量失败" description={error} />
  if (!cat) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  const columnTable = (cols: ColumnStat[]) => (
    <Table
      size="small"
      rowKey="name"
      pagination={false}
      scroll={{ x: 900 }}
      dataSource={cols}
      columns={[
        { title: '字段', dataIndex: 'name', width: 180, render: (v: string) => <span className="mono">{v}</span> },
        { title: '类型', dataIndex: 'type', width: 130 },
        {
          title: '空值率', dataIndex: 'null_pct', width: 170,
          render: (v: number) => (
            <Progress percent={Number(v.toFixed(1))} size="small" strokeColor={v > 30 ? '#dc2626' : v > 5 ? '#f59e0b' : '#0f766e'} format={() => `${v}%`} />
          ),
        },
        {
          title: '基数', dataIndex: 'distinct', width: 120,
          render: (v: number, c: ColumnStat) => <span>{fmtInt(v)}{c.distinct_approx ? '≈' : ''}</span>,
        },
        {
          title: '范围', key: 'range',
          render: (_: unknown, c: ColumnStat) =>
            c.kind === 'text' ? (c.max_length ? `最长 ${c.max_length} 字符` : '—') : `${c.min ?? '—'} ~ ${c.max ?? '—'}`,
        },
      ]}
    />
  )

  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Stat label="数据表" value={fmtInt(cat.dataset.table_count)} /></Col>
        <Col xs={12} md={6}><Stat label="字段总数" value={fmtInt(cat.dataset.column_count)} /></Col>
        <Col xs={12} md={6}><Stat label="总记录数" value={`${(cat.dataset.total_rows / 1e8).toFixed(2)} 亿`} foot={fmtInt(cat.dataset.total_rows)} /></Col>
        <Col xs={12} md={6}><Stat label="存储体积" value={fmtBytes(cat.dataset.total_bytes)} foot="Parquet + ZSTD" /></Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="section-card">
            <div className="section-title">
              <h3>表行数 TOP12</h3>
              <span>行数越多，查询越需要过滤</span>
            </div>
            <Chart
              height={320}
              option={{
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                grid: { left: 120, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1e6).toFixed(0)}M` } },
                yAxis: {
                  type: 'category',
                  inverse: true,
                  data: rows.slice(0, 12).map((r) => r.name),
                  axisLabel: { width: 110, overflow: 'truncate', fontSize: 11 },
                },
                series: [{
                  type: 'bar',
                  data: rows.slice(0, 12).map((r) => r.rows),
                  itemStyle: { color: '#2563eb', borderRadius: [0, 4, 4, 0] },
                }],
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="section-card">
            <div className="section-title">
              <h3>空值率最高字段</h3>
              <span>空值字段占比 TOP18</span>
            </div>
            <Chart
              height={320}
              option={{
                tooltip: {
                  trigger: 'axis',
                  axisPointer: { type: 'shadow' },
                  formatter: (p: { dataIndex: number; value: number }[]) => `${nullTop[p[0].dataIndex].label}<br/>${p[0].value.toFixed(1)}%`,
                },
                grid: { left: 190, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
                yAxis: {
                  type: 'category',
                  inverse: true,
                  data: nullTop.map((n) => n.label),
                  axisLabel: { width: 178, overflow: 'truncate', fontSize: 11 },
                },
                series: [{
                  type: 'bar',
                  data: nullTop.map((n) => n.pct),
                  itemStyle: { color: '#dc2626', borderRadius: [0, 4, 4, 0] },
                }],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card className="section-card" styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索表名或说明"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            点击行首展开字段级空值率与基数
          </Typography.Text>
        </div>
        <Table
          size="small"
          rowKey="name"
          dataSource={rows}
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          expandable={{ expandedRowRender: (row) => columnTable(row.columns) }}
          columns={[
            { title: '表名', dataIndex: 'name', width: 180, render: (v: string) => <strong className="mono">{v}</strong> },
            { title: '模块', dataIndex: 'module', width: 80, render: (v: string) => <Tag color={v === 'hosp' ? 'blue' : 'cyan'}>{v}</Tag> },
            { title: '行数', dataIndex: 'rows', width: 130, render: (v: number) => fmtInt(v), sorter: (a, b) => a.rows - b.rows },
            { title: '字段数', dataIndex: 'columns', width: 90, render: (v: ColumnStat[]) => v.length },
            { title: '体积', dataIndex: 'bytes', width: 110, render: (v: number) => fmtBytes(v) },
            { title: '说明', dataIndex: 'description', ellipsis: true },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        数据目录生成于 {cat.dataset.generated_at.replace('T', ' ')} · 源目录 {cat.dataset.root}
      </Typography.Text>
    </div>
  )
}
