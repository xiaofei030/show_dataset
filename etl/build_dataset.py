"""把 MIMIC-IV 2.2 的 31 张 CSV.GZ 转成 Parquet，并生成元数据目录与 DuckDB 视图。

用法：
    python etl/build_dataset.py                 # 增量构建（已存在则跳过）
    python etl/build_dataset.py --force         # 全量重建
    python etl/build_dataset.py --only patients,admissions
    python etl/build_dataset.py --skip-stats    # 只转 Parquet 和视图
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
from decimal import Decimal
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from registry import (  # noqa: E402
    CATALOG_PATH,
    DATA_DIR,
    DATASET_ROOT,
    DB_PATH,
    MODULE_LABELS,
    PARQUET_DIR,
    SEPSIS_LABEL_PATH,
    TABLES,
)

EXPECTED_ROWS = {"patients": 299_712, "admissions": 431_231, "icustays": 73_181}
NUMERIC_PREFIXES = ("INT", "BIGINT", "SMALLINT", "TINYINT", "HUGEINT", "DOUBLE",
                    "FLOAT", "REAL", "DECIMAL", "NUMERIC", "UBIGINT", "UINTEGER")
TEMPORAL_PREFIXES = ("TIMESTAMP", "DATE", "TIME", "INTERVAL")


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def new_connection() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("SET threads=16")
    con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory={sql_str((DATA_DIR / 'tmp').as_posix())}")
    con.execute("SET preserve_insertion_order=true")
    return con


def to_json_value(value):
    if value is None:
        return None
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def column_kind(dtype: str) -> str:
    d = dtype.upper()
    if d.startswith(NUMERIC_PREFIXES):
        return "number"
    if d.startswith(TEMPORAL_PREFIXES):
        return "time"
    if d.startswith("BOOL"):
        return "boolean"
    return "text"


def convert_table(con: duckdb.DuckDBPyConnection, name: str, meta: dict, force: bool) -> tuple[int, int]:
    src = DATASET_ROOT / meta["file"]
    dst = PARQUET_DIR / f"{name}.parquet"
    size_mb = src.stat().st_size / 1024 / 1024
    if dst.exists() and not force:
        rows = con.execute(
            f"SELECT count(*) FROM read_parquet({sql_str(dst.as_posix())})"
        ).fetchone()[0]
        log(f"跳过 {name:<22} 已存在，{rows:>12,} 行")
        return rows, dst.stat().st_size

    started = time.time()
    log(f"转换 {name:<22} {size_mb:>8.1f} MB ...")
    overrides: dict[str, str] = {}
    while True:
        dst.unlink(missing_ok=True)
        types_clause = ""
        if overrides:
            items = ", ".join(f"'{k}': 'VARCHAR'" for k in overrides)
            types_clause = f", types={{{items}}}"
        try:
            con.execute(
                f"""
                COPY (
                    SELECT * FROM read_csv_auto(
                        {sql_str(src.as_posix())}, header=true, sample_size=1000000{types_clause}
                    )
                ) TO {sql_str(dst.as_posix())} (FORMAT PARQUET, COMPRESSION ZSTD)
                """
            )
            break
        except duckdb.ConversionException as exc:
            match = __import__("re").search(r'column "([^"]+)"', str(exc))
            col = match.group(1) if match else None
            if not col or col in overrides or len(overrides) >= 12:
                raise
            overrides[col] = "VARCHAR"
            log(f"  {name}.{col} 含混合值，自动改为 VARCHAR 后重试")
    rows = con.execute(
        f"SELECT count(*) FROM read_parquet({sql_str(dst.as_posix())})"
    ).fetchone()[0]
    elapsed = time.time() - started
    log(f"完成 {name:<22} {rows:>12,} 行  {dst.stat().st_size / 1024 / 1024:>8.1f} MB  {elapsed:>6.1f}s")
    return rows, dst.stat().st_size


def table_stats(con: duckdb.DuckDBPyConnection, name: str, parquet: Path, columns: list[dict]) -> dict:
    select_parts = ["count(*) AS __rows"]
    for idx, col in enumerate(columns):
        ident = quote_ident(col["name"])
        select_parts.append(f"count(*) FILTER (WHERE {ident} IS NULL) AS n_{idx}")
        select_parts.append(f"approx_count_distinct({ident}) AS d_{idx}")
        if col["kind"] == "text":
            select_parts.append(f"max(length({ident})) AS l_{idx}")
        else:
            select_parts.append(f"min({ident}) AS a_{idx}")
            select_parts.append(f"max({ident}) AS b_{idx}")

    sql = (
        "SELECT " + ", ".join(select_parts)
        + f" FROM read_parquet({sql_str(parquet.as_posix())})"
    )
    row = con.execute(sql).fetchone()
    values = {"__rows": row[0]}
    pos = 1
    for idx, col in enumerate(columns):
        values[f"n_{idx}"] = row[pos]
        values[f"d_{idx}"] = row[pos + 1]
        pos += 2
        if col["kind"] == "text":
            values[f"l_{idx}"] = row[pos]
            pos += 1
        else:
            values[f"a_{idx}"] = row[pos]
            values[f"b_{idx}"] = row[pos + 1]
            pos += 2

    # 第二遍：对基数不太大的列计算精确 distinct，避免 HyperLogLog 偏差
    exact_cols = []
    for idx, col in enumerate(columns):
        approx = values[f"d_{idx}"]
        max_len = values.get(f"l_{idx}")
        if approx <= 2_000_000 and not (max_len and max_len > 1000):
            exact_cols.append((idx, col))
    if exact_cols:
        parts = []
        for idx, col in exact_cols:
            parts.append(f"count(DISTINCT {quote_ident(col['name'])}) AS e_{idx}")
        sql2 = (
            "SELECT " + ", ".join(parts)
            + f" FROM read_parquet({sql_str(parquet.as_posix())})"
        )
        row2 = con.execute(sql2).fetchone()
        for pos2, (idx, _col) in enumerate(exact_cols):
            values[f"d_{idx}"] = row2[pos2]
            values[f"e_{idx}"] = True

    final_cols = []
    for idx, col in enumerate(columns):
        item = dict(col)
        item["null_count"] = values[f"n_{idx}"]
        item["distinct"] = values[f"d_{idx}"]
        item["distinct_approx"] = not values.get(f"e_{idx}", False)
        if col["kind"] == "text":
            item["max_length"] = values[f"l_{idx}"]
            item["min"] = None
            item["max"] = None
        else:
            item["min"] = to_json_value(values[f"a_{idx}"])
            item["max"] = to_json_value(values[f"b_{idx}"])
            item["max_length"] = None
        final_cols.append(item)
    return {"rows": values["__rows"], "columns": final_cols}


def build_views(con: duckdb.DuckDBPyConnection, stats: dict) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    view_con = duckdb.connect(str(DB_PATH))
    view_con.execute("SET threads=8")
    for name in stats:
        parquet = PARQUET_DIR / f"{name}.parquet"
        view_con.execute(
            f'CREATE OR REPLACE VIEW "{name}" AS '
            f"SELECT * FROM read_parquet({sql_str(parquet.as_posix())})"
        )
    if SEPSIS_LABEL_PATH.exists():
        view_con.execute(
            'CREATE OR REPLACE VIEW "sepsis_labels" AS SELECT * FROM read_csv_auto('
            f"{sql_str(SEPSIS_LABEL_PATH.as_posix())}, header=true)"
        )
        log(f"已接入脓毒症标签视图：{SEPSIS_LABEL_PATH}")
    view_con.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="忽略已有 Parquet，全部重建")
    parser.add_argument("--only", default="", help="只处理指定表，逗号分隔")
    parser.add_argument("--skip-stats", action="store_true", help="跳过字段统计")
    parser.add_argument("--skip-views", action="store_true", help="跳过 DuckDB 视图")
    args = parser.parse_args()

    if not DATASET_ROOT.exists():
        raise SystemExit(f"数据集目录不存在：{DATASET_ROOT}")
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "tmp").mkdir(parents=True, exist_ok=True)

    selected = [t.strip() for t in args.only.split(",") if t.strip()] or list(TABLES)
    unknown = [t for t in selected if t not in TABLES]
    if unknown:
        raise SystemExit(f"未知表：{unknown}")

    con = new_connection()
    parquet_rows: dict[str, int] = {}
    parquet_bytes: dict[str, int] = {}
    for name in selected:
        parquet_rows[name], parquet_bytes[name] = convert_table(con, name, TABLES[name], args.force)

    catalog = json.loads(CATALOG_PATH.read_text("utf-8")) if CATALOG_PATH.exists() else {}
    old_tables = catalog.get("tables", {})
    tables_out: dict[str, dict] = {}
    for name in selected:
        parquet = PARQUET_DIR / f"{name}.parquet"
        columns = [
            {"name": r[0], "type": r[1], "kind": column_kind(r[1])}
            for r in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet({sql_str(parquet.as_posix())})"
            ).fetchall()
        ]
        if args.skip_stats:
            stats = {"rows": parquet_rows[name], "columns": columns}
        else:
            started = time.time()
            log(f"统计 {name:<22} {len(columns)} 列 ...")
            stats = table_stats(con, name, parquet, columns)
            log(f"完成统计 {name:<22} {time.time() - started:>6.1f}s")
        for col in stats["columns"]:
            col["null_pct"] = round(col["null_count"] / stats["rows"] * 100, 2) if stats["rows"] else 0
        tables_out[name] = {
            **TABLES[name],
            "rows": stats["rows"],
            "bytes": parquet_bytes[name],
            "columns": stats["columns"],
        }

    # 合并未重建表的旧目录（仅 --only 时）
    for name, old in old_tables.items():
        if name not in tables_out and (PARQUET_DIR / f"{name}.parquet").exists():
            tables_out[name] = old

    ordered = {name: tables_out[name] for name in TABLES if name in tables_out}
    total_rows = sum(t["rows"] for t in ordered.values())
    total_bytes = sum(t["bytes"] for t in ordered.values())
    catalog = {
        "dataset": {
            "name": "MIMIC-IV",
            "version": "2.2",
            "root": str(DATASET_ROOT),
            "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            "table_count": len(ordered),
            "column_count": sum(len(t["columns"]) for t in ordered.values()),
            "total_rows": total_rows,
            "total_bytes": total_bytes,
        },
        "modules": {
            m: {
                "label": label,
                "tables": [n for n, t in ordered.items() if t["module"] == m],
                "rows": sum(t["rows"] for t in ordered.values() if t["module"] == m),
                "bytes": sum(t["bytes"] for t in ordered.values() if t["module"] == m),
            }
            for m, label in MODULE_LABELS.items()
        },
        "tables": ordered,
    }
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), "utf-8")
    log(f"目录已写入 {CATALOG_PATH}")

    if not args.skip_views:
        build_views(con, ordered)
        log(f"DuckDB 视图已写入 {DB_PATH}")

    log("=" * 64)
    log(f"表数量 {len(ordered)}，总行数 {total_rows:,}，Parquet {total_bytes / 1024**3:.2f} GB")
    for name, expected in EXPECTED_ROWS.items():
        if name in ordered:
            actual = ordered[name]["rows"]
            flag = "OK" if actual == expected else "不一致"
            log(f"校验 {name:<12} 实际 {actual:>10,} / 预期 {expected:>10,}  {flag}")
    log("完成")


if __name__ == "__main__":
    main()
