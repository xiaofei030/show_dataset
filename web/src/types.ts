export interface ColumnStat {
  name: string
  type: string
  kind: 'text' | 'number' | 'time' | 'boolean'
  label?: string
  null_count: number
  null_pct: number
  distinct: number
  distinct_approx: boolean
  min: string | number | null
  max: string | number | null
  max_length: number | null
}

export interface TableMeta {
  name: string
  module: 'hosp' | 'icu'
  module_label: string
  description: string
  rows: number
  bytes: number
  columns: number
  key: string[] | null
  time: string | null
}

export interface DatasetInfo {
  name: string
  version: string
  root: string
  generated_at: string
  table_count: number
  column_count: number
  total_rows: number
  total_bytes: number
}

export interface MetaResponse {
  dataset: DatasetInfo
  modules: Record<string, { label: string; tables: string[]; rows: number; bytes: number }>
  tables: TableMeta[]
  column_labels: Record<string, string>
}

export interface TableDetail {
  name: string
  module: string
  description: string
  rows: number
  bytes: number
  key: string[] | null
  time: string | null
  columns: ColumnStat[]
}

export interface QueryColumn {
  name: string
  type: string
  kind: ColumnStat['kind']
  label: string
}

export interface QueryResponse {
  table: string
  columns: QueryColumn[]
  rows: (string | number | boolean | null)[][]
  total: number
  page: number
  page_size: number
  elapsed_ms: number
}

export interface Filter {
  column: string
  op: string
  value?: unknown
}

export interface SearchMatch {
  kind: 'patient' | 'admission' | 'stay'
  id: number
  subject_id: number
  hadm_id: number | null
  stay_id: number | null
  label: string
  detail: string
}

export interface SeriesItem {
  itemid: number
  label: string | null
  unit: string | null
  points: [string, number][]
  text_count: number
}

export interface OverviewData {
  dataset: DatasetInfo
  modules: Record<string, { label: string; tables: string[]; rows: number; bytes: number }>
  totals: {
    patients: number
    admissions: number
    stays: number
    expire_rate: number
    avg_los: number
  }
  gender: { gender: string; n: number }[]
  age_hist: { bucket: string; count: number }[]
  admission_type: { admission_type: string; n: number }[]
  insurance: { insurance: string; n: number }[]
  race: { race: string; n: number }[]
  los_hist: { bucket: string; count: number }[]
  careunit: { careunit: string; n: number }[]
  top_diagnoses: { icd_code: string; icd_version: number; title: string | null; n: number }[]
  top_tables: { name: string; rows: number; bytes: number }[]
}
