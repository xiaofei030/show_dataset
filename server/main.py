"""MIMIC-IV 2.2 数据浏览器后端。"""
from __future__ import annotations

import csv
import datetime as dt
import io
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from server import db, sql_guard
from registry import COLUMN_LABELS, MODULE_LABELS, PROJECT_ROOT

app = FastAPI(title="MIMIC-IV 2.2 数据浏览器", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SQL_OPS = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
MAX_PAGE_SIZE = 200
DICT_CONFIG = {
    "items": dict(table="d_items", columns=["itemid", "label", "abbreviation", "category", "unitname", "param_type"],
                  search=["label", "abbreviation", "category", "CAST(itemid AS VARCHAR)"], order="label"),
    "labitems": dict(table="d_labitems", columns=["itemid", "label", "fluid", "category"],
                     search=["label", "category", "fluid", "CAST(itemid AS VARCHAR)"], order="label"),
    "icd_diagnoses": dict(table="d_icd_diagnoses", columns=["icd_code", "icd_version", "long_title"],
                          search=["icd_code", "long_title"], order="icd_code"),
    "icd_procedures": dict(table="d_icd_procedures", columns=["icd_code", "icd_version", "long_title"],
                           search=["icd_code", "long_title"], order="icd_code"),
    "hcpcs": dict(table="d_hcpcs", columns=["code", "category", "short_description", "long_description"],
                  search=["code", "short_description", "long_description"], order="code"),
}


class Filter(BaseModel):
    column: str
    op: str = "eq"
    value: Any | None = None


class TableQuery(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=MAX_PAGE_SIZE)
    sort: str | None = None
    order: str = "asc"
    filters: list[Filter] = Field(default_factory=list)


class SqlQuery(BaseModel):
    sql: str


class ExportQuery(TableQuery):
    limit: int = Field(50_000, ge=1, le=200_000)


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def get_table(name: str) -> dict[str, Any]:
    try:
        return db.table_meta(name)
    except KeyError:
        raise HTTPException(404, f"表不存在：{name}")


def build_filters(table: str, filters: list[Filter]) -> tuple[str, list[Any]]:
    cols = db.table_column_map(table)
    clauses: list[str] = []
    params: list[Any] = []
    for f in filters:
        if f.column not in cols:
            raise HTTPException(400, f"字段不存在：{f.column}")
        ident = q(f.column)
        op = f.op
        if op in ("is_null", "not_null"):
            clauses.append(f"{ident} IS {'NULL' if op == 'is_null' else 'NOT NULL'}")
        elif op in ("contains", "startswith", "endswith"):
            pattern = {"contains": f"%{f.value}%", "startswith": f"{f.value}%", "endswith": f"%{f.value}"}[op]
            clauses.append(f"CAST({ident} AS VARCHAR) ILIKE ?")
            params.append(pattern)
        elif op == "in":
            vals = f.value if isinstance(f.value, list) else [v for v in str(f.value).split(",") if v != ""]
            if not vals:
                continue
            clauses.append(f"{ident} IN ({', '.join(['?'] * len(vals))})")
            params.extend(vals)
        elif op in SQL_OPS:
            clauses.append(f"{ident} {SQL_OPS[op]} ?")
            params.append(f.value)
        else:
            raise HTTPException(400, f"不支持的过滤操作：{op}")
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def table_select_sql(table: str, query: TableQuery) -> tuple[str, list[Any]]:
    where, params = build_filters(table, query.filters)
    order_sql = ""
    if query.sort:
        cols = db.table_column_map(table)
        if query.sort not in cols:
            raise HTTPException(400, f"排序字段不存在：{query.sort}")
        direction = "DESC" if query.order.lower() == "desc" else "ASC"
        order_sql = f" ORDER BY {q(query.sort)} {direction} NULLS LAST"
    return f"SELECT * FROM {q(table)}{where}{order_sql}", params


@app.get("/api/health")
def health():
    ready = db.data_ready()
    info: dict[str, Any] = {"ready": ready}
    if ready:
        c = db.catalog()["dataset"]
        info.update({"dataset": c, "tables": c.get("table_count"), "rows": c.get("total_rows")})
    return info


@app.get("/api/meta")
def meta():
    if not db.data_ready():
        raise HTTPException(503, "数据尚未构建，请先运行 ETL")
    cat = db.catalog()
    tables = []
    for name, t in cat["tables"].items():
        tables.append({
            "name": name,
            "module": t["module"],
            "module_label": MODULE_LABELS.get(t["module"], t["module"]),
            "description": t["description"],
            "rows": t["rows"],
            "bytes": t["bytes"],
            "columns": len(t["columns"]),
            "key": t.get("key"),
            "time": t.get("time"),
        })
    return {"dataset": cat["dataset"], "modules": cat.get("modules", {}), "tables": tables,
            "column_labels": COLUMN_LABELS}


@app.get("/api/quality")
def quality():
    if not db.data_ready():
        raise HTTPException(503, "数据尚未构建")
    return db.catalog()


@app.get("/api/tables/{table}")
def table_detail(table: str):
    t = get_table(table)
    return {
        "name": table,
        "module": t["module"],
        "description": t["description"],
        "rows": t["rows"],
        "bytes": t["bytes"],
        "key": t.get("key"),
        "time": t.get("time"),
        "columns": [{**c, "label": COLUMN_LABELS.get(c["name"], c["name"])} for c in t["columns"]],
    }


@app.post("/api/tables/{table}/query")
def table_query(table: str, body: TableQuery):
    t = get_table(table)
    sql, params = table_select_sql(table, body)
    started = time.time()
    if body.filters:
        where, count_params = build_filters(table, body.filters)
        total = db.scalar(f"SELECT count(*) FROM {q(table)}{where}", count_params)
    else:
        total = t["rows"]
    offset = (body.page - 1) * body.page_size
    rows = db.run(sql + " LIMIT ? OFFSET ?", params + [body.page_size, offset])[2]
    return {
        "table": table,
        "columns": [{"name": c["name"], "type": c["type"], "kind": c["kind"],
                     "label": COLUMN_LABELS.get(c["name"], c["name"])} for c in t["columns"]],
        "rows": rows,
        "total": total,
        "page": body.page,
        "page_size": body.page_size,
        "elapsed_ms": round((time.time() - started) * 1000, 1),
    }


_values_cache: dict[tuple, list[dict[str, Any]]] = {}
_values_lock = threading.Lock()


@app.get("/api/tables/{table}/values")
def table_values(table: str, column: str, limit: int = Query(100, ge=1, le=500), search: str = ""):
    t = get_table(table)
    cols = db.table_column_map(table)
    if column not in cols:
        raise HTTPException(400, f"字段不存在：{column}")
    key = (table, column, search, limit)
    with _values_lock:
        if key in _values_cache:
            return {"values": _values_cache[key], "cached": True}

    if column == "itemid":
        if table == "labevents":
            dict_table, label_col = "d_labitems", "label"
        else:
            dict_table, label_col = "d_items", "label"
        sql = (f"SELECT DISTINCT CAST(itemid AS VARCHAR) AS value, {label_col} AS label "
               f"FROM {dict_table} WHERE CAST(itemid AS VARCHAR) ILIKE ? OR {label_col} ILIKE ? "
               f"ORDER BY {label_col} LIMIT ?")
        pattern = f"%{search}%"
        rows = db.run_dicts(sql, [pattern, pattern, limit])
        source = dict_table
    elif t["rows"] > 20_000_000:
        return {"values": [], "suggest_manual": True,
                "message": "该表行数过大，请直接输入筛选值"}
    else:
        ident = q(column)
        sql = (f"SELECT DISTINCT CAST({ident} AS VARCHAR) AS value, NULL AS label "
               f"FROM {q(table)} WHERE {ident} IS NOT NULL AND CAST({ident} AS VARCHAR) ILIKE ? "
               f"ORDER BY 1 LIMIT ?")
        rows = db.run_dicts(sql, [f"%{search}%", limit])
        source = table
    with _values_lock:
        _values_cache[key] = rows
    return {"values": rows, "cached": False, "source": source}


@app.get("/api/search")
def search(q_: str = Query("", alias="q")):
    raw = q_.strip()
    if not raw:
        return {"matches": []}
    hint = None
    if len(raw) >= 3 and raw[1] == ":" and raw[0].upper() in ("S", "H", "I"):
        hint = {"S": "patient", "H": "admission", "I": "stay"}[raw[0].upper()]
        raw = raw[2:].strip()
    if not raw.isdigit():
        raise HTTPException(400, "请输入数字 ID：subject_id / hadm_id / stay_id")
    value = int(raw)
    matches: list[dict[str, Any]] = []

    if hint in (None, "patient"):
        r = db.one("SELECT subject_id, gender, anchor_age, anchor_year_group FROM patients WHERE subject_id=?", [value])
        if r:
            matches.append({"kind": "patient", "id": value, "subject_id": value, "hadm_id": None, "stay_id": None,
                            "label": f"患者 {value}", "detail": f"{r['gender']} · 锚定年龄 {r['anchor_age']} · {r['anchor_year_group']}"})
    if hint in (None, "admission"):
        r = db.one("SELECT subject_id, hadm_id, admittime, admission_type FROM admissions WHERE hadm_id=?", [value])
        if r:
            matches.append({"kind": "admission", "id": value, "subject_id": r["subject_id"], "hadm_id": value, "stay_id": None,
                            "label": f"住院 {value}", "detail": f"患者 {r['subject_id']} · {r['admittime']} · {r['admission_type']}"})
    if hint in (None, "stay"):
        r = db.one("SELECT subject_id, hadm_id, stay_id, first_careunit, intime FROM icustays WHERE stay_id=?", [value])
        if r:
            matches.append({"kind": "stay", "id": value, "subject_id": r["subject_id"], "hadm_id": r["hadm_id"], "stay_id": value,
                            "label": f"ICU stay {value}", "detail": f"患者 {r['subject_id']} · {r['first_careunit']} · {r['intime']}"})
    return {"matches": matches}


COMORBIDITY_RULES = [
    ("hypertension", "高血压", ("401", "402", "403", "404", "405"), ("I10", "I11", "I12", "I13", "I15")),
    ("cad", "冠心病", ("410", "411", "412", "413", "414"), ("I20", "I21", "I22", "I23", "I24", "I25")),
    ("chf", "心力衰竭", ("428",), ("I50",)),
    ("afib", "心房颤动", ("42731",), ("I48",)),
    ("cvd", "脑血管病", tuple(str(n) for n in range(430, 439)),
     ("G45", "G46", "I60", "I61", "I62", "I63", "I64", "I65", "I66", "I67", "I68", "I69")),
    ("diabetes", "糖尿病", ("250",), ("E10", "E11", "E12", "E13", "E14")),
    ("ckd", "慢性肾病", ("585", "586"), ("N18", "N19")),
    ("copd", "慢性肺病", ("490", "491", "492", "493", "494", "495", "496", "500", "501", "502", "503", "504", "505"),
     ("J40", "J41", "J42", "J43", "J44", "J45", "J46", "J47", "J60", "J61", "J62", "J63", "J64", "J65", "J66", "J67", "J68")),
    ("liver", "慢性肝病", ("570", "571", "572", "573", "070"), ("B18", "K70", "K71", "K72", "K73", "K74", "K75", "K76")),
    ("ulcer", "消化性溃疡", ("531", "532", "533", "534"), ("K25", "K26", "K27", "K28")),
    ("rheumatic", "风湿免疫病", ("4465", "710", "714"), ("M05", "M06", "M30", "M31", "M32", "M33", "M34", "M35")),
    ("dementia", "痴呆", ("290", "3312"), ("F00", "F01", "F02", "F03", "G30")),
    ("cancer", "恶性肿瘤", tuple(str(n) for n in range(140, 196)) + tuple(str(n) for n in range(200, 209)), ("C",)),
    ("thyroid", "甲状腺疾病", ("240", "241", "242", "243", "244", "245", "246"),
     ("E00", "E01", "E02", "E03", "E04", "E05", "E06", "E07")),
    ("obesity", "肥胖", ("2780", "V853"), ("E66", "Z683", "Z684")),
]


def _comorbidities(diagnoses: list[dict], admissions: list[dict], focus_hadm: int | None) -> dict:
    adm_time = {a["hadm_id"]: str(a.get("admittime") or "") for a in admissions}
    if focus_hadm in adm_time:
        focus = focus_hadm
    else:
        focus = max(adm_time, key=lambda h: adm_time[h]) if adm_time else None
    focus_time = adm_time.get(focus, "")
    buckets: dict[str, dict] = {}
    for d in diagnoses:
        version = str(d.get("icd_version"))
        code = str(d.get("icd_code") or "")
        if version not in ("9", "10"):
            continue
        for key, label, prefixes9, prefixes10 in COMORBIDITY_RULES:
            prefixes = prefixes9 if version == "9" else prefixes10
            if not any(code.upper().startswith(p) for p in prefixes):
                continue
            b = buckets.setdefault(key, {"key": key, "label": label, "hadms": set(), "codes": {},
                                          "rows": {}, "first": "", "last": ""})
            b["hadms"].add(d["hadm_id"])
            b["codes"][code] = d.get("long_title") or ""
            t = adm_time.get(d["hadm_id"], "")
            b["rows"][(d["hadm_id"], code)] = {
                "icd_version": version, "icd_code": code, "long_title": d.get("long_title") or "",
                "hadm_id": d["hadm_id"], "admittime": t,
            }
            if t:
                if not b["first"] or t < b["first"]:
                    b["first"] = t
                if not b["last"] or t > b["last"]:
                    b["last"] = t
    items = []
    for b in buckets.values():
        times = [adm_time[h] for h in b["hadms"] if adm_time.get(h)]
        examples = [f"{c} · {b['codes'][c]}" for c in sorted(b["codes"])[:3]]
        items.append({
            "key": b["key"],
            "label": b["label"],
            "hadm_count": len(b["hadms"]),
            "first_admittime": b["first"],
            "last_admittime": b["last"],
            "prior": bool(focus_time) and any(t < focus_time for t in times),
            "examples": examples,
            "details": sorted(b["rows"].values(), key=lambda r: (r["admittime"], r["icd_code"])),
        })
    items.sort(key=lambda x: (-x["hadm_count"], x["label"]))
    return {"index_hadm_id": focus, "items": items, "chronic_count": len(items), "total_diagnoses": len(diagnoses)}


@app.get("/api/patients/{subject_id}")
def patient(subject_id: int, focus_hadm: int | None = None):
    p = db.one("SELECT * FROM patients WHERE subject_id=?", [subject_id])
    if not p:
        raise HTTPException(404, f"患者不存在：{subject_id}")
    admissions = db.run_dicts("SELECT * FROM admissions WHERE subject_id=? ORDER BY admittime", [subject_id])
    stays = db.run_dicts("SELECT * FROM icustays WHERE subject_id=? ORDER BY intime", [subject_id])
    transfers = db.run_dicts("SELECT * FROM transfers WHERE subject_id=? ORDER BY intime", [subject_id])
    diagnoses = db.run_dicts(
        "SELECT d.hadm_id, d.seq_num, d.icd_code, d.icd_version, x.long_title "
        "FROM diagnoses_icd d LEFT JOIN d_icd_diagnoses x "
        "ON d.icd_code=x.icd_code AND d.icd_version=x.icd_version "
        "WHERE d.subject_id=? ORDER BY d.hadm_id, d.seq_num", [subject_id])
    procedures = db.run_dicts(
        "SELECT p.hadm_id, p.seq_num, p.chartdate, p.icd_code, p.icd_version, x.long_title "
        "FROM procedures_icd p LEFT JOIN d_icd_procedures x "
        "ON p.icd_code=x.icd_code AND p.icd_version=x.icd_version "
        "WHERE p.subject_id=? ORDER BY p.hadm_id, p.seq_num", [subject_id])
    services = db.run_dicts("SELECT * FROM services WHERE subject_id=? ORDER BY transfertime", [subject_id])
    micro = db.run_dicts("SELECT * FROM microbiologyevents WHERE subject_id=? ORDER BY charttime DESC LIMIT 300", [subject_id])
    sepsis = []
    try:
        sepsis = db.run_dicts("SELECT * FROM sepsis_labels WHERE subject_id=? ORDER BY sepsis_onset", [subject_id])
    except Exception:
        pass
    counts = db.one(
        "SELECT "
        "(SELECT count(*) FROM labevents WHERE subject_id=?) AS labevents, "
        "(SELECT count(*) FROM prescriptions WHERE subject_id=?) AS prescriptions, "
        "(SELECT count(*) FROM microbiologyevents WHERE subject_id=?) AS microbiologyevents, "
        "(SELECT count(*) FROM chartevents WHERE subject_id=?) AS chartevents, "
        "(SELECT count(*) FROM emar WHERE subject_id=?) AS emar, "
        "(SELECT count(*) FROM omr WHERE subject_id=?) AS omr",
        [subject_id] * 6,
    )
    return {"patient": p, "admissions": admissions, "stays": stays, "transfers": transfers,
            "diagnoses": diagnoses, "procedures": procedures, "services": services,
            "microbiology": micro, "sepsis": sepsis, "counts": counts,
            "comorbidities": _comorbidities(diagnoses, admissions, focus_hadm)}


@app.get("/api/stays/{stay_id}")
def stay(stay_id: int):
    s = db.one("SELECT * FROM icustays WHERE stay_id=?", [stay_id])
    if not s:
        raise HTTPException(404, f"ICU stay 不存在：{stay_id}")
    p = db.one("SELECT * FROM patients WHERE subject_id=?", [s["subject_id"]])
    a = db.one("SELECT * FROM admissions WHERE hadm_id=?", [s["hadm_id"]])
    counts = db.one(
        "SELECT "
        "(SELECT count(*) FROM chartevents WHERE stay_id=?) AS chartevents, "
        "(SELECT count(*) FROM inputevents WHERE stay_id=?) AS inputevents, "
        "(SELECT count(*) FROM outputevents WHERE stay_id=?) AS outputevents, "
        "(SELECT count(*) FROM procedureevents WHERE stay_id=?) AS procedureevents, "
        "(SELECT count(*) FROM datetimeevents WHERE stay_id=?) AS datetimeevents, "
        "(SELECT count(*) FROM ingredientevents WHERE stay_id=?) AS ingredientevents",
        [stay_id] * 6,
    )
    return {"stay": s, "patient": p, "admission": a, "counts": counts}


@app.get("/api/stays/{stay_id}/item-summary")
def stay_items(stay_id: int):
    rows = db.run_dicts(
        "SELECT c.itemid, any_value(i.label) AS label, any_value(i.category) AS category, "
        "any_value(i.unitname) AS unitname, count(*) AS n, "
        "min(c.charttime) AS first_time, max(c.charttime) AS last_time "
        "FROM chartevents c LEFT JOIN d_items i ON c.itemid=i.itemid "
        "WHERE c.stay_id=? GROUP BY c.itemid ORDER BY n DESC", [stay_id])
    return {"items": rows}


@app.get("/api/patients/{subject_id}/lab-items")
def lab_items(subject_id: int):
    rows = db.run_dicts(
        "SELECT l.itemid, any_value(d.label) AS label, any_value(d.fluid) AS fluid, "
        "any_value(d.category) AS category, count(*) AS n, "
        "min(l.charttime) AS first_time, max(l.charttime) AS last_time, "
        "any_value(l.valueuom) AS unit "
        "FROM labevents l LEFT JOIN d_labitems d ON l.itemid=d.itemid "
        "WHERE l.subject_id=? GROUP BY l.itemid ORDER BY n DESC", [subject_id])
    return {"items": rows}


@app.get("/api/patients/{subject_id}/labs")
def patient_labs(subject_id: int, itemids: str = "", limit: int = Query(2000, ge=1, le=10000)):
    ids = [int(x) for x in itemids.split(",") if x.strip().isdigit()]
    where = " AND l.itemid IN (" + ", ".join(["?"] * len(ids)) + ")" if ids else ""
    sql = ("SELECT l.charttime, l.itemid, d.label, l.value, l.valuenum, l.valueuom, l.flag, "
           "l.ref_range_lower, l.ref_range_upper "
           "FROM labevents l LEFT JOIN d_labitems d ON l.itemid=d.itemid "
           f"WHERE l.subject_id=?{where} ORDER BY l.charttime DESC LIMIT ?")
    rows = db.run_dicts(sql, [subject_id] + ids + [limit])
    return {"rows": rows}


@app.get("/api/series")
def series(source: str, subject_id: int | None = None, stay_id: int | None = None,
           itemids: str = "", limit: int = Query(8000, ge=1, le=30000)):
    ids = [int(x) for x in itemids.split(",") if x.strip().isdigit()]
    if not ids:
        raise HTTPException(400, "请至少选择一个项目")
    placeholders = ", ".join(["?"] * len(ids))
    if source == "chart":
        if stay_id is None:
            raise HTTPException(400, "chart 数据需要 stay_id")
        sql = ("SELECT c.itemid, i.label, i.unitname AS unit, c.charttime, c.valuenum, c.value "
               "FROM chartevents c LEFT JOIN d_items i ON c.itemid=i.itemid "
               f"WHERE c.stay_id=? AND c.itemid IN ({placeholders}) ORDER BY c.charttime LIMIT ?")
        rows = db.run_dicts(sql, [stay_id] + ids + [limit])
    elif source == "lab":
        if subject_id is None:
            raise HTTPException(400, "lab 数据需要 subject_id")
        sql = ("SELECT l.itemid, d.label, l.valueuom AS unit, l.charttime, l.valuenum, l.value "
               "FROM labevents l LEFT JOIN d_labitems d ON l.itemid=d.itemid "
               f"WHERE l.subject_id=? AND l.itemid IN ({placeholders}) ORDER BY l.charttime LIMIT ?")
        rows = db.run_dicts(sql, [subject_id] + ids + [limit])
    else:
        raise HTTPException(400, "source 只能是 chart 或 lab")

    grouped: dict[int, dict[str, Any]] = {}
    for r in rows:
        g = grouped.setdefault(r["itemid"], {"itemid": r["itemid"], "label": r["label"],
                                             "unit": r["unit"], "points": [], "text_count": 0})
        if r["valuenum"] is not None:
            g["points"].append([r["charttime"], r["valuenum"]])
        else:
            g["text_count"] += 1
    return {"series": list(grouped.values())}


@app.get("/api/dict/{kind}")
def dictionary(kind: str, q_: str = Query("", alias="q"), page: int = 1,
               page_size: int = Query(50, ge=1, le=200)):
    cfg = DICT_CONFIG.get(kind)
    if not cfg:
        raise HTTPException(404, f"未知字典：{kind}")
    table = cfg["table"]
    where, params = "", []
    if q_.strip():
        clauses = [f"CAST({c} AS VARCHAR) ILIKE ?" for c in cfg["search"]]
        where = " WHERE " + " OR ".join(clauses)
        params = [f"%{q_.strip()}%"] * len(clauses)
    total = db.scalar(f"SELECT count(*) FROM {table}{where}", params)
    rows = db.run_dicts(
        f"SELECT {', '.join(cfg['columns'])} FROM {table}{where} "
        f"ORDER BY {cfg['order']} LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size])
    return {"table": table, "columns": cfg["columns"], "rows": rows, "total": total,
            "page": page, "page_size": page_size}


@app.post("/api/sql")
def run_sql(body: SqlQuery):
    try:
        safe = sql_guard.validate(body.sql)
    except sql_guard.SqlRejected as exc:
        raise HTTPException(400, str(exc))
    limit = 1000
    started = time.time()
    try:
        columns, types, rows = db.run(sql_guard.wrap(safe, limit))
    except Exception as exc:
        raise HTTPException(400, f"查询失败：{exc}")
    truncated = len(rows) > limit
    return {"columns": columns, "types": types, "rows": rows[:limit], "truncated": truncated,
            "elapsed_ms": round((time.time() - started) * 1000, 1)}


@app.post("/api/tables/{table}/export")
def export_table(table: str, body: ExportQuery):
    get_table(table)
    sql, params = table_select_sql(table, body)
    columns, _types, rows = db.run(sql + " LIMIT ?", params + [body.limit])
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(columns)
    writer.writerows(rows)
    filename = f"{table}_{dt.datetime.now():%Y%m%d_%H%M%S}.csv"
    return Response(content=buf.getvalue().encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


_overview_cache: dict[str, Any] = {"ts": 0.0, "data": None}
_overview_lock = threading.Lock()


@app.get("/api/stats/overview")
def overview():
    with _overview_lock:
        if _overview_cache["data"] and time.time() - _overview_cache["ts"] < 300:
            return _overview_cache["data"]
    cat = db.catalog()
    age_rows = db.run_dicts("SELECT anchor_age, count(*) AS n FROM patients GROUP BY 1")
    bins = [("<20", 0, 19), ("20-29", 20, 29), ("30-39", 30, 39), ("40-49", 40, 49),
            ("50-59", 50, 59), ("60-69", 60, 69), ("70-79", 70, 79), ("80-89", 80, 89), ("90+", 90, 200)]
    age_hist = []
    for label, lo, hi in bins:
        age_hist.append({"bucket": label, "count": sum(r["n"] for r in age_rows if lo <= r["anchor_age"] <= hi)})
    los = db.run_dicts(
        "SELECT CASE WHEN los<1 THEN '<1' WHEN los<2 THEN '1-2' WHEN los<3 THEN '2-3' "
        "WHEN los<5 THEN '3-5' WHEN los<7 THEN '5-7' WHEN los<14 THEN '7-14' ELSE '14+' END AS bucket, "
        "count(*) AS n FROM icustays GROUP BY 1")
    los_order = ["<1", "1-2", "2-3", "3-5", "5-7", "7-14", "14+"]
    los_map = {r["bucket"]: r["n"] for r in los}
    top_dx = db.run_dicts(
        "SELECT d.icd_code, d.icd_version, any_value(x.long_title) AS title, count(*) AS n "
        "FROM diagnoses_icd d LEFT JOIN d_icd_diagnoses x "
        "ON d.icd_code=x.icd_code AND d.icd_version=x.icd_version "
        "GROUP BY 1, 2 ORDER BY n DESC LIMIT 20")
    data = {
        "dataset": cat["dataset"],
        "modules": cat["modules"],
        "totals": {
            "patients": db.scalar("SELECT count(*) FROM patients"),
            "admissions": db.scalar("SELECT count(*) FROM admissions"),
            "stays": db.scalar("SELECT count(*) FROM icustays"),
            "expire_rate": db.scalar("SELECT avg(hospital_expire_flag) FROM admissions"),
            "avg_los": db.scalar("SELECT avg(los) FROM icustays"),
        },
        "gender": db.run_dicts("SELECT gender, count(*) AS n FROM patients GROUP BY 1 ORDER BY 2 DESC"),
        "age_hist": age_hist,
        "admission_type": db.run_dicts("SELECT admission_type, count(*) AS n FROM admissions GROUP BY 1 ORDER BY 2 DESC LIMIT 10"),
        "insurance": db.run_dicts("SELECT insurance, count(*) AS n FROM admissions GROUP BY 1 ORDER BY 2 DESC LIMIT 10"),
        "race": db.run_dicts("SELECT race, count(*) AS n FROM admissions GROUP BY 1 ORDER BY 2 DESC LIMIT 8"),
        "los_hist": [{"bucket": b, "count": los_map.get(b, 0)} for b in los_order],
        "careunit": db.run_dicts("SELECT first_careunit AS careunit, count(*) AS n FROM icustays GROUP BY 1 ORDER BY 2 DESC LIMIT 10"),
        "top_diagnoses": top_dx,
        "top_tables": sorted(
            [{"name": n, "rows": t["rows"], "bytes": t["bytes"]} for n, t in cat["tables"].items()],
            key=lambda x: x["bytes"], reverse=True)[:12],
    }
    with _overview_lock:
        _overview_cache.update({"ts": time.time(), "data": data})
    return data


WEB_DIST = PROJECT_ROOT / "web" / "dist"
if (WEB_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    if not WEB_DIST.exists():
        return Response("前端尚未构建，请运行 cd web && npm run build", media_type="text/plain; charset=utf-8")
    target = WEB_DIST / full_path
    if full_path and target.is_file():
        return FileResponse(str(target))
    return FileResponse(str(WEB_DIST / "index.html"))
