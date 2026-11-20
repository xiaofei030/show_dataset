import { useState } from 'react'
import { App, Input, List, Modal, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { searchIds } from '../api'
import type { SearchMatch } from '../types'

function routeFor(match: SearchMatch) {
  if (match.kind === 'patient') return `/patient/${match.subject_id}`
  if (match.kind === 'admission') return `/patient/${match.subject_id}?hadm=${match.hadm_id}`
  return `/patient/${match.subject_id}?stay=${match.stay_id}`
}

const KIND_LABEL: Record<SearchMatch['kind'], string> = {
  patient: '患者',
  admission: '住院',
  stay: 'ICU stay',
}

export default function GlobalSearch() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)

  const go = (match: SearchMatch) => {
    setMatches(null)
    navigate(routeFor(match))
  }

  const onSearch = async (value: string) => {
    const q = value.trim()
    if (!q) return
    setLoading(true)
    try {
      const res = await searchIds(q)
      if (res.matches.length === 0) {
        message.warning('没有找到对应的患者 / 住院 / ICU stay')
      } else if (res.matches.length === 1) {
        go(res.matches[0])
      } else {
        setMatches(res.matches)
      }
    } catch (err) {
      message.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Input.Search
        className="global-search"
        allowClear
        enterButton={<SearchOutlined />}
        placeholder="输入 subject_id / hadm_id / stay_id，如 12980335"
        onSearch={onSearch}
        loading={loading}
        style={{ width: 380 }}
      />
      <Modal
        title="找到多条匹配记录"
        open={!!matches}
        footer={null}
        onCancel={() => setMatches(null)}
      >
        <List
          dataSource={matches ?? []}
          renderItem={(item) => (
            <List.Item style={{ cursor: 'pointer' }} onClick={() => go(item)}>
              <List.Item.Meta
                avatar={<Tag color={item.kind === 'patient' ? 'blue' : item.kind === 'admission' ? 'geekblue' : 'cyan'}>{KIND_LABEL[item.kind]}</Tag>}
                title={item.label}
                description={<Typography.Text type="secondary">{item.detail}</Typography.Text>}
              />
            </List.Item>
          )}
        />
      </Modal>
    </>
  )
}
