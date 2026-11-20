"""DuckDB 连接与查询辅助。"""
from __future__ import annotations

import datetime as dt
import json
import math
import threading
from decimal import Decimal
from typing import Any

import duckdb

from registry import CATALOG_PATH, DB_PATH

_local = threading.local()
_lock = threading.Lock()
_catalog: dict[str, Any] | None = None


class DataNotReady(RuntimeError):
    pass


def data_ready() -> bool:
    return DB_PATH.exists() and CATALOG_PATH.exists()


def catalog() -> dict[str, Any]:
    global _catalog
    if _catalog is None:
        with _lock:
            if _catalog is None:
                if not CATALOG_PATH.exists():
                    raise DataNotReady("catalog.json 不存在，请先运行 etl/build_dataset.py")
                _catalog = json.loads(CATALOG_PATH.read_text("utf-8"))
    return _catalog


def table_meta(name: str) -> dict[str, Any]:
    tables = catalog().get("tables", {})
    if name not in tables:
        raise KeyError(name)
    return tables[name]


def table_column_map(name: str) -> dict[str, dict[str, Any]]:
    return {c["name"]: c for c in table_meta(name)["columns"]}


def get_conn() -> duckdb.DuckDBPyConnection:
    con = getattr(_local, "con", None)
    if con is None:
        if not DB_PATH.exists():
            raise DataNotReady("mimic.duckdb 不存在，请先运行 etl/build_dataset.py")
        con = duckdb.connect(str(DB_PATH), read_only=True)
        con.execute("SET threads=8")
        con.execute("SET memory_limit='6GB'")
        _local.con = con
    return con


def json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return value


def run(sql: str, params: list[Any] | None = None) -> tuple[list[str], list[str], list[list[Any]]]:
    cur = get_conn().execute(sql, params or [])
    if cur.description is None:
        return [], [], []
    columns = [d[0] for d in cur.description]
    types = [str(d[1]) for d in cur.description]
    rows = [[json_value(v) for v in row] for row in cur.fetchall()]
    return columns, types, rows


def run_dicts(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    columns, _types, rows = run(sql, params)
    return [dict(zip(columns, row)) for row in rows]


def one(sql: str, params: list[Any] | None = None) -> dict[str, Any] | None:
    rows = run_dicts(sql, params)
    return rows[0] if rows else None


def scalar(sql: str, params: list[Any] | None = None) -> Any:
    columns, _types, rows = run(sql, params)
    return rows[0][0] if rows else None
