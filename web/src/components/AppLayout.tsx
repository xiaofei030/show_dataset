import { useEffect, useState } from 'react'
import { Alert, Badge, Layout, Menu, Space, Typography } from 'antd'
import {
  AreaChartOutlined,
  BookOutlined,
  CodeOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import GlobalSearch from './GlobalSearch'
import { api } from '../api'

const { Sider, Header, Content, Footer } = Layout

const MENU = [
  { key: '/', icon: <AreaChartOutlined />, label: '总览' },
  { key: '/tables', icon: <TableOutlined />, label: '数据表' },
  { key: '/patient', icon: <UserOutlined />, label: '患者全景' },
  { key: '/dictionary', icon: <BookOutlined />, label: '字典与编码' },
  { key: '/sql', icon: <CodeOutlined />, label: 'SQL 工作台' },
  { key: '/quality', icon: <SafetyCertificateOutlined />, label: '数据质量' },
]

const TITLES: Record<string, { title: string; sub: string }> = {
  '/': { title: '数据集总览', sub: 'MIMIC-IV 2.2 · 全量 31 张表' },
  '/tables': { title: '数据表浏览', sub: '按表粒度检索全部字段与记录' },
  '/patient': { title: '患者全景', sub: '按 subject_id / hadm_id / stay_id 检索' },
  '/dictionary': { title: '字典与编码', sub: 'ICU 项目、检验项目、ICD 与 HCPCS' },
  '/sql': { title: 'SQL 工作台', sub: '只读查询，结果可导出' },
  '/quality': { title: '数据质量', sub: '行数、字段空值率与基数画像' },
}

function selectedKey(pathname: string) {
  if (pathname.startsWith('/tables')) return '/tables'
  if (pathname.startsWith('/patient')) return '/patient'
  if (pathname.startsWith('/dictionary')) return '/dictionary'
  if (pathname.startsWith('/sql')) return '/sql'
  if (pathname.startsWith('/quality')) return '/quality'
  return '/'
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [health, setHealth] = useState<{ ready: boolean } | null>(null)
  const key = selectedKey(location.pathname)
  const title = TITLES[key] ?? TITLES['/']

  useEffect(() => {
    api<{ ready: boolean }>('/api/health').then(setHealth).catch(() => setHealth({ ready: false }))
  }, [location.pathname])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={228} className="app-sider" breakpoint="lg" collapsedWidth={0}>
        <Link to="/" className="logo">
          <span className="logo-mark">
            <DatabaseOutlined />
          </span>
          <span>
            <strong>MIMIC-IV</strong>
            <small>数据浏览器 · v2.2</small>
          </span>
        </Link>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[key]}
          items={MENU}
          onClick={({ key: path }) => navigate(path)}
          style={{ background: 'transparent', borderInlineEnd: 'none' }}
        />
        <div className="sider-foot">
          <Badge status={health?.ready ? 'success' : 'error'} />
          {health?.ready ? '数据已就绪' : '数据未构建'}
          <div className="sider-foot-note">仅限本地研究使用</div>
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {title.title}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {title.sub}
            </Typography.Text>
          </div>
          <Space size="large">
            <GlobalSearch />
          </Space>
        </Header>
        <Content className="app-content">
          {health && !health.ready && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="数据尚未构建"
              description="请先在项目根目录运行：.venv\\Scripts\\python.exe etl\\build_dataset.py"
            />
          )}
          <Outlet />
        </Content>
        <Footer className="app-footer">
          数据来源 MIMIC-IV v2.2 · 本工具仅用于本地数据浏览与研究，请遵守 MIMIC 数据使用协议
        </Footer>
      </Layout>
    </Layout>
  )
}
