import { useState } from 'react'
import { Alert, App, Button, Card, Input, Space, Table, Tag, Typography } from 'antd'
import { DownloadOutlined, PlayCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api, downloadCsv, fmtInt } from '../api'

const EXAMPLES = [
  {
    label: '患者列表',
    sql: 'SELECT subject_id, gender, anchor_age, anchor_year_group\nFROM patients\nLIMIT 100',
  },
  {
    label: '入院类型分布',
    sql: 'SELECT admission_type, count(*) AS n\nFROM admissions\nGROUP BY 1\nORDER BY n DESC',
  },
  {
    label: 'ICU 记录最多的 stay',
    sql: 'SELECT stay_id, count(*) AS n\nFROM chartevents\nGROUP BY 1\nORDER BY n DESC\nLIMIT 20',
  },
  {
    label: '检验项目 TOP10',
    sql: 'SELECT itemid, count(*) AS n\nFROM labevents\nGROUP BY 1\nORDER BY n DESC\nLIMIT 10',
  },
  {
    label: '脓毒症标签概览',
    sql: 'SELECT definition_level, count(*) AS n, round(avg(sofa_at_onset), 1) AS avg_sofa\nFROM sepsis_labels\nGROUP BY 1',
  },
]

interface SqlResult {
  columns: string[]
  types: string[]
  rows: (string | number | boolean | null)[][]
  truncated: boolean
  elapsed_ms: number
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function SqlWorkbench() {
  const { message } = App.useApp()
  const [sql, setSql] = useState(EXAMPLES[0].sql)
  const [result, setResult] = useState<SqlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (!sql.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api<SqlResult>('/api/sql', { method: 'POST', body: JSON.stringify({ sql }) })
      setResult(res)
    } catch (err) {
      setError((err as Error).message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const exportResult = () => {
    if (!result) return
    const lines = [result.columns.map(csvCell).join(',')]
    result.rows.forEach((row) => lines.push(row.map(csvCell).join(',')))
    downloadCsv('sql_result.csv', lines.join('\n'))
    message.success('已导出当前查询结果（最多 1000 行）')
  }

  const dataSource = (result?.rows ?? []).map((row, i) => {
    const obj: Record<string, unknown> = { __key: i }
    row.forEach((v, j) => { obj[`c${j}`] = v })
    return obj
  })

  const columns = (result?.columns ?? []).map((name, i) => ({
    title: (
      <div>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{result?.types[i]}</div>
      </div>
    ),
    dataIndex: `c${i}`,
    key: `c${i}`,
    ellipsis: true,
    width: 180,
    render: (v: unknown) => (v === null || v === undefined ? <span className="muted">—</span> : String(v)),
  }))

  return (
    <div className="page-stack">
      <Card className="section-card">
        <Space wrap style={{ marginBottom: 10 }}>
          <Tag icon={<ThunderboltOutlined />} color="processing">只读查询</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            仅允许 SELECT / WITH；自动限制 1000 行；禁止写操作与文件函数。
          </Typography.Text>
        </Space>
        <Input.TextArea
          className="sql-editor"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          autoSize={{ minRows: 6, maxRows: 16 }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run()
          }}
        />
        <Space wrap style={{ marginTop: 12 }}>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={run}>
            运行（Ctrl + Enter）
          </Button>
          <Button icon={<DownloadOutlined />} disabled={!result} onClick={exportResult}>导出结果</Button>
          {result && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fmtInt(result.rows.length)} 行 · {result.elapsed_ms} ms
            </Typography.Text>
          )}
        </Space>
        <div style={{ marginTop: 12 }}>
          <Space wrap>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>示例：</span>
            {EXAMPLES.map((ex) => (
              <Button key={ex.label} size="small" onClick={() => setSql(ex.sql)}>{ex.label}</Button>
            ))}
          </Space>
        </div>
      </Card>

      {error && <Alert type="error" showIcon message="查询失败" description={error} />}
      {result?.truncated && <Alert type="warning" showIcon message="结果超过 1000 行，仅显示前 1000 行。请增加过滤条件或聚合。" />}

      <Card className="section-card" styles={{ body: { padding: 0 } }}>
        <Table
          size="small"
          rowKey="__key"
          columns={columns}
          dataSource={dataSource}
          scroll={{ x: 'max-content', y: 520 }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
          locale={{ emptyText: '运行 SQL 后在这里查看结果' }}
        />
      </Card>

      <Card className="section-card">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          可用对象：31 张原始表 + sepsis_labels 标签视图。表名可直接使用，例如
          <span className="mono"> patients</span>、
          <span className="mono"> admissions</span>、
          <span className="mono"> icustays</span>、
          <span className="mono"> chartevents</span>、
          <span className="mono"> labevents</span>。
        </Typography.Text>
      </Card>
    </div>
  )
}
