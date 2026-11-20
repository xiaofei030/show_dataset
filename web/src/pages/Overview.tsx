import { useEffect, useState } from 'react'
import { Alert, Card, Col, Row, Skeleton, Tag, Typography } from 'antd'
import { DatabaseOutlined, HeartOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { fmtBytes, fmtInt, getOverview } from '../api'
import type { OverviewData } from '../types'
import Chart, { PALETTE } from '../components/Chart'

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <Card className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </Card>
  )
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOverview().then(setData).catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <Alert type="error" showIcon message="加载总览失败" description={error} />
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />

  const { totals, dataset } = data
  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6} xl={3}>
          <Stat label="患者总数" value={fmtInt(totals.patients)} foot="subject_id" />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="住院总数" value={fmtInt(totals.admissions)} foot="hadm_id" />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="ICU stay" value={fmtInt(totals.stays)} foot="stay_id" />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="数据表" value={fmtInt(dataset.table_count)} foot={`${dataset.column_count} 个字段`} />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="总记录数" value={`${(dataset.total_rows / 1e8).toFixed(2)} 亿`} foot={fmtInt(dataset.total_rows)} />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="Parquet 体积" value={fmtBytes(dataset.total_bytes)} foot="列式压缩存储" />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="院内死亡率" value={`${(totals.expire_rate * 100).toFixed(1)}%`} foot="hospital_expire_flag" />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <Stat label="平均 ICU LOS" value={`${totals.avg_los.toFixed(1)} 天`} foot="icustays.los" />
        </Col>
      </Row>

      <Card className="section-card">
        <div className="section-title">
          <h3>数据粒度</h3>
          <span>所有查询都围绕这三层 ID 展开</span>
        </div>
        <div className="model-flow">
          <div className="model-node">
            <strong>subject_id · 患者</strong>
            <span>{fmtInt(totals.patients)} 人</span>
          </div>
          <span className="model-arrow">→</span>
          <div className="model-node">
            <strong>hadm_id · 住院</strong>
            <span>{fmtInt(totals.admissions)} 次</span>
          </div>
          <span className="model-arrow">→</span>
          <div className="model-node">
            <strong>stay_id · ICU stay</strong>
            <span>{fmtInt(totals.stays)} 次</span>
          </div>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            一个患者可多次住院，一次住院可多次进入 ICU；ICU 事件表只带 stay_id。
          </Typography.Text>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card className="section-card">
            <div className="section-title">
              <h3>年龄分布</h3>
              <span>anchor_age</span>
            </div>
            <Chart
              height={280}
              option={{
                tooltip: { trigger: 'axis' },
                grid: { left: 48, right: 16, top: 16, bottom: 28 },
                xAxis: { type: 'category', data: data.age_hist.map((d) => d.bucket), axisTick: { show: false } },
                yAxis: { type: 'value' },
                series: [
                  {
                    type: 'bar',
                    data: data.age_hist.map((d) => d.count),
                    itemStyle: { color: '#0f766e', borderRadius: [4, 4, 0, 0] },
                  },
                ],
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card className="section-card">
            <div className="section-title">
              <h3>性别构成</h3>
              <span>patients.gender</span>
            </div>
            <Chart
              height={280}
              option={{
                tooltip: { trigger: 'item' },
                legend: { bottom: 0 },
                color: ['#2563eb', '#f59e0b'],
                series: [
                  {
                    type: 'pie',
                    radius: ['48%', '72%'],
                    avoidLabelOverlap: true,
                    itemStyle: { borderColor: '#fff', borderWidth: 2 },
                    label: { formatter: '{b}\n{d}%' },
                    data: data.gender.map((d) => ({ name: d.gender, value: d.n })),
                  },
                ],
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="section-card">
            <div className="section-title">
              <h3>入院类型 TOP10</h3>
              <span>admissions.admission_type</span>
            </div>
            <Chart
              height={280}
              option={{
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                grid: { left: 118, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value' },
                yAxis: {
                  type: 'category',
                  inverse: true,
                  data: data.admission_type.map((d) => d.admission_type),
                  axisLabel: { width: 108, overflow: 'truncate' },
                },
                series: [
                  {
                    type: 'bar',
                    data: data.admission_type.map((d) => d.n),
                    itemStyle: { color: '#2563eb', borderRadius: [0, 4, 4, 0] },
                  },
                ],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card className="section-card">
            <div className="section-title">
              <h3>ICU 住院时长</h3>
              <span>icustays.los · 天</span>
            </div>
            <Chart
              height={270}
              option={{
                tooltip: { trigger: 'axis' },
                grid: { left: 48, right: 16, top: 16, bottom: 28 },
                xAxis: { type: 'category', data: data.los_hist.map((d) => d.bucket) },
                yAxis: { type: 'value' },
                series: [
                  {
                    type: 'bar',
                    data: data.los_hist.map((d) => d.count),
                    itemStyle: { color: '#0891b2', borderRadius: [4, 4, 0, 0] },
                  },
                ],
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="section-card">
            <div className="section-title">
              <h3>诊断 TOP15</h3>
              <span>diagnoses_icd</span>
            </div>
            <Chart
              height={270}
              option={{
                tooltip: {
                  trigger: 'axis',
                  axisPointer: { type: 'shadow' },
                  formatter: (params: { dataIndex: number; value: number }[]) => {
                    const item = data.top_diagnoses.slice(0, 15)[params[0].dataIndex]
                    return `${item.title ?? item.icd_code}<br/>${fmtInt(item.n)} 条记录`
                  },
                },
                grid: { left: 178, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value' },
                yAxis: {
                  type: 'category',
                  inverse: true,
                  data: data.top_diagnoses.slice(0, 15).map((d) => d.title ?? d.icd_code),
                  axisLabel: { width: 168, overflow: 'truncate', fontSize: 11 },
                },
                series: [
                  {
                    type: 'bar',
                    data: data.top_diagnoses.slice(0, 15).map((d) => d.n),
                    itemStyle: { color: '#7c3aed', borderRadius: [0, 4, 4, 0] },
                  },
                ],
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="section-card">
            <div className="section-title">
              <h3>表体积 TOP12</h3>
              <span>Parquet 压缩后</span>
            </div>
            <Chart
              height={270}
              option={{
                tooltip: {
                  trigger: 'axis',
                  axisPointer: { type: 'shadow' },
                  formatter: (params: { dataIndex: number; value: number }[]) => {
                    const item = data.top_tables[params[0].dataIndex]
                    return `${item.name}<br/>${fmtBytes(item.bytes)}<br/>${fmtInt(item.rows)} 行`
                  },
                },
                grid: { left: 118, right: 24, top: 8, bottom: 24 },
                xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1024 ** 3).toFixed(1)}G` } },
                yAxis: {
                  type: 'category',
                  inverse: true,
                  data: data.top_tables.map((d) => d.name),
                  axisLabel: { width: 108, overflow: 'truncate', fontSize: 11 },
                },
                series: [
                  {
                    type: 'bar',
                    data: data.top_tables.map((d) => d.bytes),
                    itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] },
                  },
                ],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="section-card">
            <div className="section-title">
              <h3>模块概览</h3>
              <span>{dataset.root}</span>
            </div>
            {Object.entries(data.modules).map(([key, mod]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px dashed #e8edf4' }}>
                <div>
                  <Tag color={key === 'hosp' ? 'blue' : 'cyan'}>{key}</Tag>
                  <strong>{mod.label}</strong>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{mod.tables.length} 张表</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>{fmtInt(mod.rows)} 行</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{fmtBytes(mod.bytes)}</div>
                </div>
              </div>
            ))}
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              构建时间：{dataset.generated_at.replace('T', ' ')} · 数据版本 MIMIC-IV {dataset.version}
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="section-card">
            <div className="section-title">
              <h3>快速入口</h3>
              <span>常用检索方式</span>
            </div>
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <Card size="small" hoverable>
                  <TeamOutlined style={{ color: '#2563eb', fontSize: 20 }} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>患者全景</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>输入 subject_id 查看全部就诊记录</div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" hoverable>
                  <DatabaseOutlined style={{ color: '#0f766e', fontSize: 20 }} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>数据表浏览</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>31 张表全字段分页与筛选</div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" hoverable>
                  <ThunderboltOutlined style={{ color: '#f59e0b', fontSize: 20 }} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>SQL 工作台</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>只读 SQL，直接查询 Parquet</div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" hoverable>
                  <HeartOutlined style={{ color: '#dc2626', fontSize: 20 }} />
                  <div style={{ fontWeight: 600, marginTop: 8 }}>时序探索</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>生命体征与检验曲线</div>
                </Card>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
