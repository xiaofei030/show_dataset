import { useEffect, useMemo, useState } from 'react'
import {
  Alert, App, Button, Card, Col, Collapse, Descriptions, Empty, Input, Popover, Row, Select,
  Space, Spin, Table, Tabs, Tag, Timeline, Typography,
} from 'antd'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, fmtInt, getSeries, queryTable } from '../api'
import type { QueryResponse, SeriesItem } from '../types'
import Chart, { PALETTE } from '../components/Chart'

interface ComorbidityDetail {
  icd_version: string
  icd_code: string
  long_title: string
  hadm_id: number
  admittime: string
}

interface Comorbidity {
  key: string
  label: string
  hadm_count: number
  first_admittime: string
  last_admittime: string
  prior: boolean
  examples: string[]
  details: ComorbidityDetail[]
}

interface PatientData {
  patient: Record<string, any>
  admissions: Record<string, any>[]
  stays: Record<string, any>[]
  transfers: Record<string, any>[]
  diagnoses: Record<string, any>[]
  procedures: Record<string, any>[]
  services: Record<string, any>[]
  microbiology: Record<string, any>[]
  sepsis: Record<string, any>[]
  counts: Record<string, number>
  comorbidities: {
    index_hadm_id: number | null
    items: Comorbidity[]
    chronic_count: number
    total_diagnoses: number
  }
}

const VITALS = [220045, 220210, 220277, 223762, 220179, 220180]
const LABS = [50813, 50912, 51301, 51222, 51265, 50931]
const MED_COLS = ['starttime', 'stoptime', 'drug', 'drug_type', 'route', 'dose_val_rx', 'dose_unit_rx', 'doses_per_24_hrs']

function SeriesChart({ series, height = 340 }: { series: SeriesItem[]; height?: number }) {
  const usable = series.filter((s) => s.points.length > 0)
  if (!usable.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可绘制的数值" />
  return (
    <Chart
      height={height}
      option={{
        color: PALETTE,
        tooltip: { trigger: 'axis' },
        legend: { type: 'scroll', top: 0, textStyle: { fontSize: 11 } },
        grid: { left: 56, right: 24, top: 46, bottom: 58 },
        xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
        yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#eef2f7' } } },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10 }],
        series: usable.map((s) => ({
          name: `${s.label ?? s.itemid}${s.unit ? ` (${s.unit})` : ''}`,
          type: 'line',
          showSymbol: false,
          connectNulls: true,
          lineStyle: { width: 1.8 },
          data: s.points,
        })),
      }}
    />
  )
}

function MedsTab({ subjectId }: { subjectId: number }) {
  const [page, setPage] = useState(1)
  const [resp, setResp] = useState<QueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    queryTable('prescriptions', {
      page, page_size: 20,
      filters: [{ column: 'subject_id', op: 'eq', value: subjectId }],
    }).then(setResp).finally(() => setLoading(false))
  }, [subjectId, page])
  if (!resp) return <Spin />
  const cols = resp.columns.filter((c) => MED_COLS.includes(c.name))
  const idx = (name: string) => resp.columns.findIndex((c) => c.name === name)
  const data = resp.rows.map((r, i) => {
    const obj: Record<string, unknown> = { __key: i }
    cols.forEach((c) => { obj[c.name] = r[idx(c.name)] })
    return obj
  })
  return (
    <Card className="section-card" styles={{ body: { padding: 0 } }}>
      <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>
        共 <strong>{fmtInt(resp.total)}</strong> 条处方记录 · 第 {page} 页
      </div>
      <Table
        size="small"
        loading={loading}
        rowKey="__key"
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ current: page, pageSize: 20, total: resp.total, onChange: setPage, showTotal: (t) => `共 ${fmtInt(t)} 条` }}
        columns={cols.map((c) => ({
          title: c.label !== c.name ? `${c.name} · ${c.label}` : c.name,
          dataIndex: c.name,
          width: c.kind === 'time' ? 165 : 150,
          ellipsis: true,
          render: (v: unknown) => (v === null || v === undefined || v === '' ? <span className="muted">—</span> : String(v)),
        }))}
      />
    </Card>
  )
}

function LabsTab({ subjectId }: { subjectId: number }) {
  const [items, setItems] = useState<Record<string, any>[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [series, setSeries] = useState<SeriesItem[]>([])
  const [rows, setRows] = useState<Record<string, any>[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api<{ items: Record<string, any>[] }>(`/api/patients/${subjectId}/lab-items`).then((d) => {
      setItems(d.items)
      const present = LABS.filter((id) => d.items.some((i) => Number(i.itemid) === id)).slice(0, 4)
      setSelected(present.length ? present : d.items.filter((i) => i.unit).slice(0, 3).map((i) => Number(i.itemid)))
    }).catch(() => setItems([]))
  }, [subjectId])

  useEffect(() => {
    if (!selected.length) { setSeries([]); setRows([]); return }
    setLoading(true)
    Promise.all([
      getSeries({ source: 'lab', subject_id: subjectId, itemids: selected, limit: 8000 }),
      api<{ rows: Record<string, any>[] }>(`/api/patients/${subjectId}/labs?itemids=${selected.join(',')}&limit=200`),
    ]).then(([s, r]) => { setSeries(s.series); setRows(r.rows) }).finally(() => setLoading(false))
  }, [selected, subjectId])

  const options = items.map((i) => ({
    value: Number(i.itemid),
    label: `${i.label ?? i.itemid}${i.unit ? ` · ${i.unit}` : ''} (${fmtInt(i.n)})`,
  }))

  return (
    <div className="page-stack">
      <Card className="section-card" styles={{ body: { padding: 16 } }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <span style={{ color: '#475569', fontSize: 13 }}>检验项目</span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            value={selected}
            onChange={setSelected}
            options={options}
            style={{ minWidth: 520, maxWidth: '100%' }}
            placeholder="选择检验项目，可多选"
            optionFilterProp="label"
            maxTagCount={4}
          />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>共 {items.length} 个项目</span>
        </Space>
        <Spin spinning={loading}>
          <SeriesChart series={series} height={360} />
        </Spin>
      </Card>
      <Card className="section-card" styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>最近 200 条检验值</div>
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: '时间', dataIndex: 'charttime', width: 170, render: fmtDateTime },
            { title: '项目', dataIndex: 'label', width: 220, ellipsis: true },
            { title: '值', dataIndex: 'value', width: 130 },
            { title: '数值', dataIndex: 'valuenum', width: 110 },
            { title: '单位', dataIndex: 'valueuom', width: 100 },
            { title: '异常', dataIndex: 'flag', width: 90, render: (v: unknown) => (v ? <Tag color="red">{String(v)}</Tag> : '—') },
            {
              title: '参考区间', key: 'ref', width: 140,
              render: (_: unknown, r: Record<string, any>) => `${r.ref_range_lower ?? '—'} ~ ${r.ref_range_upper ?? '—'}`,
            },
          ]}
        />
      </Card>
    </div>
  )
}

function IcuTab({ stays, initialStay }: { stays: Record<string, any>[]; initialStay?: number }) {
  const [stayId, setStayId] = useState<number | undefined>(initialStay ?? stays[0]?.stay_id)
  const [items, setItems] = useState<Record<string, any>[]>([])
  const [category, setCategory] = useState<string>('')
  const [selected, setSelected] = useState<number[]>([])
  const [series, setSeries] = useState<SeriesItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (initialStay) setStayId(initialStay)
  }, [initialStay])

  useEffect(() => {
    if (!stayId) return
    setLoading(true)
    api<{ items: Record<string, any>[] }>(`/api/stays/${stayId}/item-summary`).then((d) => {
      setItems(d.items)
      const present = VITALS.filter((id) => d.items.some((i) => Number(i.itemid) === id))
      setSelected(present.length ? present : d.items.filter((i) => i.unitname).slice(0, 3).map((i) => Number(i.itemid)))
      setCategory('')
    }).finally(() => setLoading(false))
  }, [stayId])

  useEffect(() => {
    if (!stayId || !selected.length) { setSeries([]); return }
    getSeries({ source: 'chart', stay_id: stayId, itemids: selected, limit: 12000 }).then((d) => setSeries(d.series))
  }, [stayId, selected])

  if (!stays.length) return <Empty description="该患者没有 ICU stay 记录" />
  const stay = stays.find((s) => Number(s.stay_id) === Number(stayId))
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[]
  const visible = items.filter((i) => !category || i.category === category).slice(0, 300)
  const options = visible.map((i) => ({
    value: Number(i.itemid),
    label: `${i.label ?? i.itemid}${i.unitname ? ` · ${i.unitname}` : ''} (${fmtInt(i.n)})`,
  }))

  return (
    <div className="page-stack">
      <Card className="section-card" styles={{ body: { padding: 16 } }}>
        <Space wrap>
          <span style={{ color: '#475569', fontSize: 13 }}>ICU stay</span>
          <Select
            style={{ width: 460 }}
            value={stayId}
            onChange={setStayId}
            options={stays.map((s) => ({
              value: Number(s.stay_id),
              label: `${s.stay_id} · ${s.first_careunit ?? '—'} · ${fmtDateTime(s.intime)}`,
            }))}
          />
          {stay && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fmtDateTime(stay.intime)} → {fmtDateTime(stay.outtime)} · LOS {stay.los ?? '—'} 天
            </Typography.Text>
          )}
        </Space>
        <Space wrap style={{ marginTop: 12 }}>
          <span style={{ color: '#475569', fontSize: 13 }}>类别</span>
          <Select
            style={{ width: 240 }}
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: '全部类别' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <span style={{ color: '#475569', fontSize: 13 }}>项目</span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            value={selected}
            onChange={setSelected}
            options={options}
            style={{ minWidth: 520, maxWidth: '100%' }}
            optionFilterProp="label"
            maxTagCount={4}
            placeholder="选择要绘制的项目"
          />
        </Space>
        <Spin spinning={loading}>
          <SeriesChart series={series} height={380} />
        </Spin>
      </Card>
    </div>
  )
}

export default function Patient() {
  const { subjectId } = useParams<{ subjectId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [data, setData] = useState<PatientData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState('stays')
  const [hadmFilter, setHadmFilter] = useState<string>('')
  const sid = subjectId ? Number(subjectId) : undefined
  const hadm = searchParams.get('hadm') ?? ''
  const stay = searchParams.get('stay') ?? ''

  useEffect(() => {
    if (!sid) return
    setData(null)
    setError(null)
    api<PatientData>(`/api/patients/${sid}${hadm ? `?focus_hadm=${hadm}` : ''}`)
      .then((d) => {
        setData(d)
        setActiveKey(stay ? 'icu' : hadm ? 'stays' : 'stays')
      })
      .catch((err: Error) => setError(err.message))
  }, [sid, hadm, stay])

  if (!subjectId) {
    return (
      <Card className="section-card" style={{ maxWidth: 720, margin: '48px auto', textAlign: 'center' }}>
        <Typography.Title level={3}>患者全景</Typography.Title>
        <Typography.Paragraph type="secondary">
          输入 subject_id、hadm_id 或 stay_id，系统会自动识别并带出所属患者、住院与 ICU 上下文。
        </Typography.Paragraph>
        <Input.Search
          size="large"
          enterButton="检索"
          placeholder="如 12980335 / 23552849 / 30001148"
          onSearch={(v) => {
            const value = v.trim()
            if (!value) return
            if (value.startsWith('H:')) navigate(`/patient?hadm=${value.slice(2)}`)
            else if (value.startsWith('I:')) navigate(`/patient?stay=${value.slice(2)}`)
            else navigate(`/patient/${value.replace(/^S:/, '')}`)
          }}
          style={{ maxWidth: 480 }}
        />
        <div style={{ marginTop: 16, color: '#94a3b8', fontSize: 12 }}>
          示例患者：<Link to="/patient/10000032">10000032</Link>
        </div>
      </Card>
    )
  }

  if (error) return <Alert type="error" showIcon message="加载患者失败" description={error} />
  if (!data) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  const p = data.patient
  const sepsis = data.sepsis?.[0]
  const filteredDx = hadmFilter ? data.diagnoses.filter((d) => String(d.hadm_id) === hadmFilter) : data.diagnoses
  const filteredProc = hadmFilter ? data.procedures.filter((d) => String(d.hadm_id) === hadmFilter) : data.procedures

  const items = [
    {
      key: 'stays',
      label: '住院与 ICU',
      children: (
        <div className="page-stack">
          {sepsis && (
            <Alert
              type="warning"
              showIcon
              message={`脓毒症标签：${data.sepsis.length} 条`}
              description={`首次发作 ${fmtDateTime(sepsis.sepsis_onset)} · SOFA ${sepsis.sofa_at_onset ?? '—'} · 定义级别 ${sepsis.definition_level ?? '—'}`}
            />
          )}
          <Card className="section-card" styles={{ body: { padding: 0 } }}>
            <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>住院记录 · {data.admissions.length} 次</div>
            <Table
              size="small"
              rowKey="hadm_id"
              dataSource={data.admissions}
              pagination={false}
              scroll={{ x: 1000 }}
              rowClassName={(r) => (String(r.hadm_id) === hadm ? 'row-highlight' : '')}
              columns={[
                { title: 'hadm_id', dataIndex: 'hadm_id', width: 120, render: (v) => <span className="id-pill">{v}</span> },
                { title: '入院时间', dataIndex: 'admittime', width: 170, render: fmtDateTime },
                { title: '出院时间', dataIndex: 'dischtime', width: 170, render: fmtDateTime },
                { title: '入院类型', dataIndex: 'admission_type', width: 130 },
                { title: '入院来源', dataIndex: 'admission_location', width: 160, ellipsis: true },
                { title: '保险', dataIndex: 'insurance', width: 100 },
                { title: '院内死亡', dataIndex: 'hospital_expire_flag', width: 100, render: (v) => (v ? <Tag color="red">是</Tag> : '否') },
              ]}
            />
          </Card>
          <Card className="section-card" styles={{ body: { padding: 0 } }}>
            <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>ICU stay · {data.stays.length} 次</div>
            <Table
              size="small"
              rowKey="stay_id"
              dataSource={data.stays}
              pagination={false}
              scroll={{ x: 900 }}
              rowClassName={(r) => (String(r.stay_id) === stay ? 'row-highlight' : '')}
              columns={[
                { title: 'stay_id', dataIndex: 'stay_id', width: 120, render: (v) => <span className="id-pill">{v}</span> },
                { title: '首个护理单元', dataIndex: 'first_careunit', width: 160 },
                { title: '最后护理单元', dataIndex: 'last_careunit', width: 160 },
                { title: '入科', dataIndex: 'intime', width: 170, render: fmtDateTime },
                { title: '出科', dataIndex: 'outtime', width: 170, render: fmtDateTime },
                { title: 'LOS（天）', dataIndex: 'los', width: 100 },
                {
                  title: '', key: 'op', width: 110,
                  render: (_: unknown, r: Record<string, any>) => (
                    <Button type="link" size="small" onClick={() => { setActiveKey('icu'); navigate(`/patient/${sid}?stay=${r.stay_id}`, { replace: true }) }}>
                      查看时序
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
          {data.transfers.length > 0 && (
            <Card className="section-card">
              <Collapse
                ghost
                items={[{
                  key: 'transfers',
                  label: `转科记录（${data.transfers.length}）`,
                  children: (
                    <Timeline
                      items={data.transfers.slice(-30).map((t) => ({
                        color: 'blue',
                        children: (
                          <div>
                            <strong>{fmtDateTime(t.intime)}</strong> · {t.careunit ?? '—'} <Tag>{t.eventtype}</Tag>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>{fmtDateTime(t.outtime)}</div>
                          </div>
                        ),
                      }))}
                    />
                  ),
                }]}
              />
            </Card>
          )}
        </div>
      ),
    },
    {
      key: 'diagnoses',
      label: `诊断与手术 (${data.diagnoses.length})`,
      children: (
        <div className="page-stack">
          <Space>
            <span style={{ color: '#475569', fontSize: 13 }}>按住院筛选</span>
            <Select
              style={{ width: 220 }}
              value={hadmFilter}
              onChange={setHadmFilter}
              options={[{ value: '', label: '全部住院' }, ...data.admissions.map((a) => ({ value: String(a.hadm_id), label: String(a.hadm_id) }))]}
            />
          </Space>
          <Card className="section-card" styles={{ body: { padding: 0 } }}>
            <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>诊断 · {filteredDx.length} 条</div>
            <Table
              size="small"
              rowKey={(r, i) => `${r.hadm_id}-${r.seq_num}-${i}`}
              dataSource={filteredDx}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              scroll={{ x: 900 }}
              columns={[
                { title: 'hadm_id', dataIndex: 'hadm_id', width: 120 },
                { title: '序号', dataIndex: 'seq_num', width: 70 },
                { title: 'ICD 编码', dataIndex: 'icd_code', width: 130, render: (v) => <span className="mono">{v}</span> },
                { title: '版本', dataIndex: 'icd_version', width: 70 },
                { title: '诊断标题', dataIndex: 'long_title', ellipsis: true },
              ]}
            />
          </Card>
          <Card className="section-card" styles={{ body: { padding: 0 } }}>
            <div style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>手术与操作 · {filteredProc.length} 条</div>
            <Table
              size="small"
              rowKey={(r, i) => `${r.hadm_id}-${r.seq_num}-${i}`}
              dataSource={filteredProc}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              scroll={{ x: 900 }}
              columns={[
                { title: 'hadm_id', dataIndex: 'hadm_id', width: 120 },
                { title: '日期', dataIndex: 'chartdate', width: 120 },
                { title: 'ICD 编码', dataIndex: 'icd_code', width: 130, render: (v) => <span className="mono">{v}</span> },
                { title: '版本', dataIndex: 'icd_version', width: 70 },
                { title: '手术标题', dataIndex: 'long_title', ellipsis: true },
              ]}
            />
          </Card>
        </div>
      ),
    },
    { key: 'meds', label: `用药 (${fmtInt(data.counts.prescriptions)})`, children: <MedsTab subjectId={Number(subjectId)} /> },
    { key: 'labs', label: `检验 (${fmtInt(data.counts.labevents)})`, children: <LabsTab subjectId={Number(subjectId)} /> },
    { key: 'icu', label: `ICU 时序 (${data.stays.length})`, children: <IcuTab stays={data.stays} initialStay={stay ? Number(stay) : undefined} /> },
    {
      key: 'micro',
      label: `微生物 (${fmtInt(data.counts.microbiologyevents)})`,
      children: (
        <Card className="section-card" styles={{ body: { padding: 0 } }}>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={data.microbiology}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '时间', dataIndex: 'charttime', width: 170, render: fmtDateTime },
              { title: '标本', dataIndex: 'spec_type_desc', width: 150 },
              { title: '检验', dataIndex: 'test_name', width: 180, ellipsis: true },
              { title: '病原体', dataIndex: 'org_name', width: 180, ellipsis: true },
              { title: '抗生素', dataIndex: 'ab_name', width: 160, ellipsis: true },
              { title: '药敏', dataIndex: 'interpretation', width: 80 },
            ]}
          />
        </Card>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <Card className="detail-hero">
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <div className="hero-label">SUBJECT ID</div>
            <Space align="center" size="middle" wrap>
              <span className="hero-value" style={{ fontSize: 28 }}>{sid}</span>
              <Tag color="rgba(255,255,255,0.18)" style={{ color: '#fff', border: 'none' }}>
                {p.gender === 'M' ? '男' : '女'} · 锚定年龄 {p.anchor_age}
              </Tag>
              {sepsis && <Tag color="red">脓毒症</Tag>}
              <Tag style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>{p.anchor_year_group}</Tag>
            </Space>
            <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              锚定年份 {p.anchor_year} · 死亡日期 {p.dod ? fmtDateTime(p.dod) : '—'}
            </div>
          </Col>
          <Col>
            <Space size={10} wrap>
              {[
                ['住院', data.admissions.length],
                ['ICU stay', data.stays.length],
                ['检验', data.counts.labevents],
                ['用药', data.counts.prescriptions],
                ['ICU 记录', data.counts.chartevents],
                ['微生物', data.counts.microbiologyevents],
              ].map(([label, value]) => (
                <div className="hero-metric" key={String(label)}>
                  <strong>{fmtInt(Number(value))}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </Space>
          </Col>
        </Row>
      </Card>

      <Card className="section-card" styles={{ body: { paddingTop: 8 } }}>
        <Tabs activeKey={activeKey} onChange={setActiveKey} items={items} destroyInactiveTabPane={false} />
      </Card>

      <Card className="section-card">
        <Descriptions
          size="small"
          title="患者基础信息"
          column={{ xs: 1, md: 3 }}
          items={[
            { key: 'sid', label: 'subject_id', children: <span className="mono">{p.subject_id}</span> },
            { key: 'gender', label: '性别', children: p.gender },
            { key: 'age', label: '锚定年龄', children: p.anchor_age },
            { key: 'year', label: '锚定年份', children: p.anchor_year },
            { key: 'group', label: '年份组', children: p.anchor_year_group },
            {
              key: 'dod', label: '死亡日期',
              children: p.dod
                ? <span>{fmtDateTime(p.dod)} <Typography.Text type="secondary" style={{ fontSize: 12 }}>（平移日期）</Typography.Text></span>
                : '—',
            },
            {
              key: 'comorbidities', label: '基础病（ICD 归并）', span: 'filled',
              children: data.comorbidities.items.length ? (
                <div>
                  <Space size={[6, 6]} wrap>
                    {data.comorbidities.items.map((c) => (
                      <Popover
                        key={c.key}
                        trigger={['hover', 'click']}
                        placement="bottomLeft"
                        title={`${c.label} · 具体诊断（${c.details.length} 条）`}
                        content={
                          <div style={{ maxWidth: 560, maxHeight: 280, overflow: 'auto' }}>
                            {c.details.map((d, i) => (
                              <div
                                key={`${d.hadm_id}-${d.icd_code}-${i}`}
                                style={{
                                  display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0',
                                  borderBottom: '1px dashed #eef2f7', fontSize: 12,
                                }}
                              >
                                <span className="mono" style={{ flex: 'none', color: '#0f766e', minWidth: 54 }}>{d.icd_code}</span>
                                <span style={{ flex: 'none', width: 58, color: '#94a3b8' }}>ICD-{d.icd_version}</span>
                                <span style={{ flex: 1, color: '#334155' }}>{d.long_title}</span>
                                <span style={{ flex: 'none', color: '#94a3b8' }}>
                                  {d.hadm_id} · {fmtDateTime(d.admittime).slice(0, 10)}
                                </span>
                              </div>
                            ))}
                            <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                              依次为：编码 · 版本 · 诊断标题 · hadm_id · 入院日期
                            </div>
                          </div>
                        }
                      >
                        <Tag color={c.prior ? 'blue' : 'gold'} style={{ cursor: 'pointer' }}>
                          {c.label} <span style={{ opacity: 0.65 }}>×{c.hadm_count}</span>
                        </Tag>
                      </Popover>
                    ))}
                  </Space>
                  <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                    共 {data.comorbidities.chronic_count} 类、{fmtInt(data.comorbidities.total_diagnoses)} 条诊断编码；蓝色 = 本次入院前已记录，金色 = 仅本次入院记录；悬停或点击标签查看具体诊断（编码、版本、住院）。
                  </div>
                </div>
              ) : <span className="muted">无诊断记录</span>,
            },
            { key: 'omr', label: '门诊测量记录', children: fmtInt(data.counts.omr) },
            { key: 'emar', label: '给药记录', children: fmtInt(data.counts.emar) },
            { key: 'services', label: '医疗服务记录', children: data.services.length },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          提示：MIMIC-IV 所有日期均按患者做了随机年份平移（落在 2100–2200 年），因此死亡日期可能显示为“未来”时间；日期之间的相对间隔不变，换算真实年份请参考年份组（anchor year group）。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
