import { useEffect, useState } from 'react'
import type { Filter, MetaResponse, OverviewData, QueryResponse, SearchMatch, SeriesItem, TableDetail } from './types'

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* ignore */
    }
    throw new ApiError(detail)
  }
  return res.json() as Promise<T>
}

export const getMeta = () => api<MetaResponse>('/api/meta')
export const getTable = (table: string) => api<TableDetail>(`/api/tables/${table}`)
export const queryTable = (table: string, body: {
  page: number
  page_size: number
  sort?: string | null
  order?: string
  filters?: Filter[]
}) => api<QueryResponse>(`/api/tables/${table}/query`, { method: 'POST', body: JSON.stringify(body) })
export const getOverview = () => api<OverviewData>('/api/stats/overview')
export const searchIds = (q: string) => api<{ matches: SearchMatch[] }>(`/api/search?q=${encodeURIComponent(q)}`)
export const getSeries = (params: { source: 'lab' | 'chart'; subject_id?: number; stay_id?: number; itemids: number[]; limit?: number }) => {
  const search = new URLSearchParams({ source: params.source, itemids: params.itemids.join(',') })
  if (params.subject_id) search.set('subject_id', String(params.subject_id))
  if (params.stay_id) search.set('stay_id', String(params.stay_id))
  if (params.limit) search.set('limit', String(params.limit))
  return api<{ series: SeriesItem[] }>(`/api/series?${search.toString()}`)
}

let metaCache: MetaResponse | null = null
let metaPromise: Promise<MetaResponse> | null = null

export function useMeta() {
  const [meta, setMeta] = useState<MetaResponse | null>(metaCache)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (metaCache) return
    if (!metaPromise) metaPromise = getMeta()
    metaPromise
      .then((data) => {
        metaCache = data
        setMeta(data)
      })
      .catch((err: Error) => setError(err.message))
  }, [])
  return { meta, error }
}

export function clearMetaCache() {
  metaCache = null
  metaPromise = null
}

export const fmtInt = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('zh-CN')

export const fmtBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export const fmtDateTime = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—'
  return String(value).replace('T', ' ').replace(/\.\d+$/, '')
}

export function downloadCsv(filename: string, content: Blob | string) {
  const blob = typeof content === 'string' ? new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
