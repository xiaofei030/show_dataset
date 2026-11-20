import { useEffect, useState } from 'react'
import { Alert, App, Card, Input, Space, Table, Tabs, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { api, fmtInt, useMeta } from '../api'

const KINDS = [
  { key: 'items', label: 'ICU 项目 d_items' },
  { key: 'labitems', label: '检验项目 d_labitems' },
  { key: 'icd_diagnoses', label: 'ICD 诊断' },
  { key: 'icd_procedures', label: 'ICD 手术' },
  { key: 'hcpcs', label: 'HCPCS' },
]

export default function Dictionary() {
  const { message } = App.useApp()
  const { meta } = useMeta()
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') ?? 'items'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ columns: string[]; rows: Record<string, unknown>[]; total: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setQ(params.get('q') ?? '')
    setPage(1)
  }, [kind])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api<{ columns: string[]; rows: Record<string, unknown>[]; total: number }>(
      `/api/dict/${kind}?q=${encodeURIComponent(q)}&page=${page}&page_size=50`,
    )
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [kind, q, page])

  const labels = meta?.column_labels ?? {}
  const columns = (data?.columns ?? []).map((name) => ({
    title: labels[name] && labels[name] !== name ? `${name} · ${labels[name]}` : name,
    dataIndex: name,
    key: name,
    ellipsis: true,
    width: name === 'long_title' || name === 'long_description' ? 460 : name.startsWith('icd') ? 130 : 180,
    render: (v: unknown) => (v === null || v === undefined ? <span className="muted">—</span> : String(v)),
  }))

  return (
    <div className="page-stack">
      <Card className="section-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Tabs
            activeKey={kind}
            onChange={(k) => {
              setParams({ kind: k })
              setQ('')
            }}
            items={KINDS.map((k) => ({ key: k.key, label: k.label }))}
          />
          <Input.Search
            allowClear
            enterButton={<SearchOutlined />}
            placeholder="搜索名称、编码、类别，如 norepinephrine / 50813 / sepsis"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            onSearch={(v) => { setQ(v); setPage(1) }}
            style={{ maxWidth: 620 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            共 {fmtInt(data?.total)} 条记录 · 第 {page} 页
          </Typography.Text>
        </Space>
      </Card>

      {error && <Alert type="error" showIcon message={error} />}

      <Card className="section-card" styles={{ body: { padding: 0 } }}>
        <Table
          size="small"
          loading={loading}
          rowKey={(_, i) => String(i)}
          columns={columns}
          dataSource={data?.rows ?? []}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize: 50,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (t) => `共 ${fmtInt(t)} 条`,
          }}
        />
      </Card>

      <Card className="section-card">
        <Space wrap>
          <Tag color="blue">d_items</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ICU 事件表中的 itemid 通过 d_items 映射为名称、类别和单位；检验表 labevents 使用 d_labitems。
          </Typography.Text>
        </Space>
      </Card>
    </div>
  )
}
