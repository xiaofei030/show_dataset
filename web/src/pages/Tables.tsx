import { useEffect, useMemo, useState } from 'react'
import {
  Alert, App, Button, Card, Col, Collapse, Empty, Input, Progress, Row, Select, Space,
  Spin, Table, Tag, Tooltip, Typography,
} from 'antd'
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  downloadCsv, fmtBytes, fmtDateTime, fmtInt, getTable, queryTable, useMeta,
} from '../api'
import type { ColumnStat, Filter, QueryColumn, QueryResponse, TableDetail } from '../types'

const OPS = [
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is_null', label: '为空' },
  { value: 'not_null', label: '不为空' },
]
const OP_LABEL = Object.fromEntries(OPS.map((o) => [o.value, o.label]))

function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function fmtVal(v: unknown) {
  if (v === null || v === undefined) return '—'
  return typeof v === 'number' ? v.toLocaleString('zh-CN') : String(v)
}

function dictKind(table: string) {
  return table === 'labevents' ? 'labitems' : 'items'
}

function renderCell(value: unknown, col: QueryColumn, row: Record<string, unknown>) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>
  if (col.name === 'subject_id') {
    return <Link className="id-pill" to={`/patient/${value}`}>{String(value)}</Link>
  }
  if (col.name === 'hadm_id' && row.subject_id) {
    return <Link className="id-pill" to={`/patient/${row.subject_id}?hadm=${value}`}>{String(value)}</Link>
  }
  if (col.name === 'stay_id' && row.subject_id) {
    return <Link className="id-pill" to={`/patient/${row.subject_id}?stay=${value}`}>{String(value)}</Link>
  }
  if (col.name === 'itemid') {
    return (
      <Link className="id-pill" to={`/dictionary?kind=${dictKind(String(row.__table ?? ''))}&q=${value}`}>
        {String(value)}
      </Link>
    )
  }
  const text = col.kind === 'time' ? fmtDateTime(value) : String(value)
  if (text.length > 120) {
    return (
      <Tooltip title={<div style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{text}</div>}>
        <span className="truncate-cell">{text.slice(0, 120)}…</span>
      </Tooltip>
    )
  }
  return <span className={col.kind === 'time' ? 'mono' : undefined}>{text}</span>
}

export default function Tables() {
  const params = useParams<{ table?: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { meta, error: metaError } = useMeta()
  const table = params.table ?? meta?.tables[0]?.name
  const [detail, setDetail] = useState<TableDetail | null>(null)
  const [resp, setResp] = useState<QueryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<string | null>(null)
  const [order, setOrder] = useState('asc')
  const [filters, setFilters] = useState<Filter[]>([])
  const [find, setFind] = useState('')
  const [draftColumn, setDraftColumn] = useState<string>()
  const [draftOp, setDraftOp] = useState('contains')
  const [draftValue, setDraftValue] = useState('')
  const [valueOptions, setValueOptions] = useState<{ value: string; label?: string }[] | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!params.table && meta?.tables.length) navigate(`/tables/${meta.tables[0].name}`, { replace: true })
  }, [params.table, meta, navigate])

  useEffect(() => {
    if (!table) return
    setDetail(null)
    setResp(null)
    setError(null)
    setPage(1)
    setFilters([])
    setSort(null)
    setOrder('asc')
    getTable(table).then(setDetail).catch((err: Error) => setError(err.message))
  }, [table])

  useEffect(() => {
    if (!table || !detail) return
    let cancelled = false
    setLoading(true)
    queryTable(table, { page, page_size: pageSize, sort, order, filters })
      .then((res) => { if (!cancelled) { setResp(res); setError(null) } })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [table, detail, page, pageSize, sort, order, filters])

  useEffect(() => {
    if (!table || !draftColumn) { setValueOptions(null); return }
    const col = detail?.columns.find((c) => c.name === draftColumn)
    if (!col) return
    setDraftOp(col.kind === 'text' ? 'contains' : 'eq')
    setDraftValue('')
    let cancelled = false
    const allow = col.name === 'itemid' || (col.distinct <= 200 && (detail?.rows ?? 0) <= 20_000_000)
    if (allow) {
      fetch(`/api/tables/${table}/values?column=${encodeURIComponent(draftColumn)}&limit=100`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setValueOptions(d.values?.length ? d.values : null) })
        .catch(() => { if (!cancelled) setValueOptions(null) })
    } else {
      setValueOptions(null)
    }
    return () => { cancelled = true }
  }, [draftColumn, table, detail])

  const groups = useMemo(() => {
    if (!meta) return []
    const needle = find.trim().toLowerCase()
    return ['hosp', 'icu'].map((mod) => ({
      key: mod,
      label: meta.modules[mod]?.label ?? mod,
      tables: meta.tables.filter(
        (t) => t.module === mod &&
          (!needle || t.name.includes(needle) || t.description.toLowerCase().includes(needle)),
      ),
    }))
  }, [meta, find])

  const dataSource = useMemo(() => {
    if (!resp) return []
    return resp.rows.map((row, idx) => {
      const obj: Record<string, unknown> = { __key: idx, __table: resp.table }
      resp.columns.forEach((col, i) => { obj[col.name] = row[i] })
      return obj
    })
  }, [resp])

  const tableColumns = useMemo(() => {
    if (!resp) return []
    return resp.columns.map((col) => ({
      title: (
        <div>
          <div style={{ fontWeight: 600 }}>{col.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{col.label !== col.name ? col.label : col.type}</div>
        </div>
      ),
      dataIndex: col.name,
      key: col.name,
      sorter: true,
      sortOrder: sort === col.name ? (order === 'desc' ? 'descend' : 'ascend') : null,
      width: col.kind === 'time' ? 172 : col.kind === 'number' ? 122 : 186,
      ellipsis: true,
      render: (value: unknown, row: Record<string, unknown>) => renderCell(value, col, row),
    }))
  }, [resp, sort, order])

  const addFilter = () => {
    if (!draftColumn) return
    if (!['is_null', 'not_null'].includes(draftOp) && draftValue === '') {
      message.warning('请输入筛选值')
      return
    }
    const col = detail?.columns.find((c) => c.name === draftColumn)
    const numeric = col?.kind === 'number' && draftValue !== '' && !Number.isNaN(Number(draftValue))
    setFilters([
      ...filters,
      {
        column: draftColumn,
        op: draftOp,
        value: ['is_null', 'not_null'].includes(draftOp) ? null : numeric ? Number(draftValue) : draftValue,
      },
    ])
    setDraftValue('')
    setPage(1)
  }

  const doExport = async () => {
    if (!table) return
    setExporting(true)
    try {
      const res = await fetch(`/api/tables/${table}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 1, page_size: pageSize, sort, order, filters, limit: 50000 }),
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      downloadCsv(`${table}.csv`, blob)
      message.success('已导出最多 5 万行')
    } catch (err) {
      message.error((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  if (metaError) return <Alert type="error" showIcon message="无法读取数据集" description={metaError} />
  if (!meta) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  const schemaColumns = [
    { title: '字段', dataIndex: 'name', width: 170, render: (v: string) => <span className="mono">{v}</span> },
    { title: '中文', dataIndex: 'label', width: 130 },
    { title: '类型', dataIndex: 'type', width: 130 },
    {
      title: '空值率', dataIndex: 'null_pct', width: 150,
      render: (v: number) => (
        <Progress percent={Number(v.toFixed(1))} size="small" strokeColor={v > 30 ? '#dc2626' : v > 5 ? '#f59e0b' : '#0f766e'} format={() => `${v}%`} />
      ),
    },
    {
      title: '基数', dataIndex: 'distinct', width: 110,
      render: (v: number, c: ColumnStat) => <span title={c.distinct_approx ? '近似值' : '精确值'}>{compact(v)}{c.distinct_approx ? '≈' : ''}</span>,
    },
    {
      title: '范围', key: 'range',
      render: (_: unknown, c: ColumnStat) =>
        c.kind === 'text' ? (c.max_length ? `最长 ${c.max_length} 字符` : '—') : `${fmtVal(c.min)} ~ ${fmtVal(c.max)}`,
    },
  ]

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={6} xl={5}>
        <Card className="section-card" styles={{ body: { padding: 12 } }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索表名 / 说明"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div className="table-list">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="table-group-label">{group.label} · {group.tables.length}</div>
                {group.tables.map((t) => (
                  <div
                    key={t.name}
                    className={`table-list-item ${t.name === table ? 'active' : ''}`}
                    onClick={() => navigate(`/tables/${t.name}`)}
                  >
                    <span>
                      <div>{t.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </div>
                    </span>
                    <small>{compact(t.rows)}</small>
                  </div>
                ))}
              </div>
            ))}
            {groups.every((g) => g.tables.length === 0) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的表" />}
          </div>
        </Card>
      </Col>

      <Col xs={24} lg={18} xl={19}>
        {!detail ? (
          <Card className="section-card"><Spin /></Card>
        ) : (
          <div className="page-stack">
            <Card className="section-card">
              <div className="section-title" style={{ marginBottom: 10 }}>
                <div>
                  <Space align="center">
                    <h3 style={{ fontSize: 18 }}>{detail.name}</h3>
                    <Tag color={detail.module === 'hosp' ? 'blue' : 'cyan'}>{detail.module}</Tag>
                    {detail.key && <Tag>主键 {detail.key.join(' + ')}</Tag>}
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    {detail.description}
                  </Typography.Paragraph>
                </div>
                <Space>
                  <span style={{ color: '#64748b', fontSize: 12 }}>
                    {fmtInt(detail.rows)} 行 · {fmtBytes(detail.bytes)} · {detail.columns.length} 字段
                    {detail.columns.some((c) => c.kind === 'time') && ' · 日期已去标识化平移'}
                  </span>
                  <Button icon={<ReloadOutlined />} onClick={() => setFilters([...filters])}>刷新</Button>
                  <Button icon={<DownloadOutlined />} loading={exporting} onClick={doExport}>导出 CSV</Button>
                </Space>
              </div>

              {detail.rows > 20_000_000 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="这是超大表"
                  description="未加过滤的查询会扫描较多数据。建议先按 subject_id、hadm_id、stay_id 或 itemid 过滤，再翻页。"
                />
              )}
              {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

              <div className="filter-bar">
                <Space wrap>
                  <Select
                    showSearch
                    placeholder="选择字段"
                    style={{ width: 210 }}
                    value={draftColumn}
                    onChange={setDraftColumn}
                    options={detail.columns.map((c) => ({
                      value: c.name,
                      label: `${c.name}${c.label !== c.name ? ` · ${c.label}` : ''}`,
                    }))}
                  />
                  <Select
                    style={{ width: 120 }}
                    value={draftOp}
                    onChange={setDraftOp}
                    options={OPS.filter((o) => {
                      const col = detail.columns.find((c) => c.name === draftColumn)
                      if (!col) return true
                      if (col.kind === 'text') return ['contains', 'eq', 'neq', 'is_null', 'not_null'].includes(o.value)
                      if (col.kind === 'boolean') return ['eq', 'neq', 'is_null', 'not_null'].includes(o.value)
                      return !['contains'].includes(o.value)
                    })}
                  />
                  {!['is_null', 'not_null'].includes(draftOp) && (
                    valueOptions ? (
                      <Select
                        showSearch
                        allowClear
                        placeholder="选择值"
                        style={{ width: 240 }}
                        value={draftValue || undefined}
                        onChange={(v) => setDraftValue(v ?? '')}
                        options={valueOptions.map((v) => ({
                          value: v.value,
                          label: v.label ? `${v.value} · ${v.label}` : v.value,
                        }))}
                      />
                    ) : (
                      <Input
                        placeholder="输入筛选值"
                        style={{ width: 200 }}
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        onPressEnter={addFilter}
                      />
                    )
                  )}
                  <Button type="primary" onClick={addFilter}>添加筛选</Button>
                  {filters.length > 0 && <Button onClick={() => { setFilters([]); setPage(1) }}>清空</Button>}
                </Space>
                {filters.length > 0 && (
                  <Space wrap style={{ marginTop: 10 }}>
                    {filters.map((f, i) => (
                      <Tag
                        key={i}
                        closable
                        color="processing"
                        onClose={() => { setFilters(filters.filter((_, j) => j !== i)); setPage(1) }}
                      >
                        {f.column} {OP_LABEL[f.op] ?? f.op} {f.value === null ? '' : String(f.value)}
                      </Tag>
                    ))}
                  </Space>
                )}
              </div>

              <Collapse
                ghost
                size="small"
                items={[{
                  key: 'schema',
                  label: `字段结构（${detail.columns.length}）`,
                  children: (
                    <Table
                      size="small"
                      rowKey="name"
                      pagination={false}
                      columns={schemaColumns as never[]}
                      dataSource={detail.columns.map((c) => ({ ...c, label: c.label ?? c.name })) as never[]}
                      scroll={{ x: 900 }}
                    />
                  ),
                }]}
              />
            </Card>

            <Card className="section-card" styles={{ body: { padding: 0 } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                <span style={{ fontSize: 13, color: '#475569' }}>
                  共 <strong>{fmtInt(resp?.total)}</strong> 行
                  {resp && <span style={{ color: '#94a3b8' }}> · 查询 {resp.elapsed_ms} ms</span>}
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {sort ? `按 ${sort} ${order === 'desc' ? '降序' : '升序'}` : '自然顺序'} · 第 {page} 页
                </span>
              </div>
              <Table
                size="small"
                loading={loading}
                rowKey="__key"
                columns={tableColumns as never[]}
                dataSource={dataSource}
                pagination={{
                  current: page,
                  pageSize,
                  total: resp?.total ?? 0,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 50, 100, 200],
                  showTotal: (total) => `共 ${fmtInt(total)} 行`,
                  onChange: (p, ps) => { setPage(p); setPageSize(ps) },
                }}
                scroll={{ x: 'max-content', y: 520 }}
                onChange={(pagination, _f, sorter) => {
                  setPage(pagination.current ?? 1)
                  const s = Array.isArray(sorter) ? sorter[0] : sorter
                  setSort((s?.field as string) ?? null)
                  setOrder(s?.order === 'descend' ? 'desc' : 'asc')
                }}
              />
            </Card>
          </div>
        )}
      </Col>
    </Row>
  )
}
