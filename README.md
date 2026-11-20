# MIMIC-IV 2.2 数据浏览器

本地运行的可视化查阅工具，覆盖 MIMIC-IV v2.2 全部 31 张表（hosp 22 张 + icu 9 张，约 6.38 亿行）的原始数据。

- 后端：FastAPI + DuckDB（只读）+ Parquet（ZSTD）
- 前端：React 18 + TypeScript + Vite + Ant Design 5 + ECharts
- 检索主线：`subject_id` → `hadm_id` → `stay_id`，统一搜索框自动识别 ID 类型

## 功能

| 页面 | 内容 |
|---|---|
| 总览 | 患者/住院/ICU 核心指标、年龄与性别分布、入院类型、住院时长、诊断 TOP、表体积 |
| 数据表 | 31 张表结构、字段统计、筛选/排序/分页、CSV 导出，ID 可点击跳转 |
| 患者全景 | 基础信息、基础病画像、住院与 ICU、诊断与手术、用药、检验趋势、ICU 时序、微生物、脓毒症标签 |
| 字典与编码 | ICU 项目、检验项目、ICD 诊断/手术、HCPCS |
| SQL 工作台 | 只读查询、结果导出（最多 1000 行） |
| 数据质量 | 全表行数/体积、空值率、字段画像 |

## 目录结构

```
show_dataset/
├── registry.py           # 数据集路径、31 张表清单、字段中文名
├── etl/build_dataset.py  # CSV.GZ → Parquet + catalog.json + DuckDB 视图
├── server/
│   ├── main.py           # FastAPI 全部接口
│   ├── db.py             # DuckDB 只读连接与序列化
│   └── sql_guard.py      # SQL 只读守卫
├── web/                  # React 前端源码
├── data/                 # 生成物（不入库）
│   ├── parquet/          # 31 张 Parquet
│   ├── catalog.json      # 元数据目录
│   └── mimic.duckdb      # 视图库
└── start.bat             # 一键启动
```

## 环境要求

- Python 3.10+（已在 3.12 验证）
- Node.js 18+（已在 22 验证）
- 磁盘：源数据 7.16 GB，Parquet 约 4.6 GB
- MIMIC-IV v2.2 原始数据目录，默认 `E:\Sepsis_datasetts\datasets\mimic-iv-2.2`

如数据在别处，设置环境变量（PowerShell）：

```powershell
$env:MIMIC_ROOT = "D:\data\mimic-iv-2.2"
```

## 快速开始

### 1. 安装依赖

```powershell
python -m venv .venv
.venv\Scripts\pip install duckdb==2.0.0 fastapi uvicorn

cd web
npm install
npm run build
cd ..
```

### 2. 构建数据（首次必须执行）

```powershell
.venv\Scripts\python.exe etl\build_dataset.py
```

可选参数：

```powershell
# 全部重建（忽略已有 Parquet）
.venv\Scripts\python.exe etl\build_dataset.py --force

# 只处理部分表
.venv\Scripts\python.exe etl\build_dataset.py --only patients,admissions,icustays

# 跳过字段统计或视图生成
.venv\Scripts\python.exe etl\build_dataset.py --skip-stats --skip-views
```

完成后会校验 `patients=299,712`、`admissions=431,231`、`icustays=73,181`。

### 3. 启动

双击 `start.bat`，或在项目根目录执行：

```powershell
.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

浏览器打开 <http://127.0.0.1:8000>。

### 前端开发模式

需要同时启动后端（8000）与 Vite（5173，已配置 `/api` 代理）：

```powershell
# 终端 1：后端
.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000

# 终端 2：前端
cd web
npm run dev
```

打开 <http://127.0.0.1:5173>。

## 数据说明

- 源 CSV 已按 `subject_id` 排序，ETL 直接写 Parquet，患者维度查询依靠 row-group 统计做裁剪
- `data/catalog.json` 记录每表每列的空值数/空值率、基数（精确值优先）、最小/最大值、最大长度
- `data/mimic.duckdb` 中为 31 个视图，查询始终落在 Parquet 上
- 若存在 `sepsis_label.csv`（路径见 `registry.py` 的 `SEPSIS_LABEL_PATH`，可用环境变量 `SEPSIS_LABEL` 覆盖），会额外挂载 `sepsis_labels` 视图，患者页可叠加脓毒症标签
- 基础病画像由 ICD-9/10 编码按前缀归并，覆盖高血压、冠心病、心衰、房颤、脑血管病、糖尿病、慢性肾病、慢性肺病、慢性肝病、消化性溃疡、风湿免疫病、痴呆、恶性肿瘤、甲状腺疾病、肥胖；仅作辅助参考

## 注意事项

- MIMIC-IV 所有日期均按患者随机平移至 2100–2200 年，死亡日期可能显示为“未来”；相对间隔不变，真实年份参考 `anchor_year_group`
- SQL 工作台仅允许 `SELECT` / `WITH`，单条语句，最多返回 1000 行
- 大表（`chartevents`、`labevents`）未加过滤时会扫描大量数据，建议先按 `subject_id`、`hadm_id`、`stay_id` 或 `itemid` 过滤
- `data/`、`.venv/`、`web/node_modules/`、`web/dist/` 不纳入版本控制，克隆后需按上述步骤重建
- 服务仅监听 `127.0.0.1`，不对外暴露

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 数据集与 31 张表元信息 |
| GET | `/api/search?q=` | 统一 ID 搜索（支持 `S:` / `H:` / `I:` 前缀） |
| GET | `/api/patients/{subject_id}` | 患者全景（可加 `?focus_hadm=`） |
| GET | `/api/stays/{stay_id}` | ICU stay 详情 |
| POST | `/api/tables/{table}/query` | 服务端分页/排序/筛选 |
| GET | `/api/series?source=lab\|chart` | 检验或 ICU 时序 |
| GET | `/api/dict/{kind}` | 字典检索 |
| POST | `/api/sql` | 只读 SQL |
| GET | `/api/stats/overview` | 总览统计（缓存 5 分钟） |
