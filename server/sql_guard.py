"""SQL 工作台的只读校验。"""
from __future__ import annotations

import re

FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|"
    r"COPY|EXPORT|IMPORT|INSTALL|LOAD|PRAGMA|CALL|SET|RESET|VACUUM|CHECKPOINT|"
    r"BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|SUMMARIZE|FORCE)\b",
    re.IGNORECASE,
)
FORBIDDEN_FUNCTIONS = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|parquet_scan|read_json|read_json_auto|"
    r"glob|httpfs|shell|getenv|which_secret)\b",
    re.IGNORECASE,
)


class SqlRejected(ValueError):
    pass


def _strip_literals(sql: str) -> str:
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql)
    sql = re.sub(r'"(?:""|[^"])*"', '""', sql)
    return sql


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def validate(sql: str) -> str:
    text = _strip_comments(sql).strip()
    while text.endswith(";"):
        text = text[:-1].rstrip()
    if not text:
        raise SqlRejected("SQL 不能为空")
    if ";" in _strip_literals(text):
        raise SqlRejected("只允许执行单条语句")
    if not re.match(r"^(SELECT|WITH)\b", text, re.IGNORECASE):
        raise SqlRejected("只允许 SELECT 或 WITH 查询")
    probe = _strip_literals(text)
    match = FORBIDDEN_KEYWORDS.search(probe)
    if match:
        raise SqlRejected(f"不允许使用关键字 {match.group(0).upper()}")
    match = FORBIDDEN_FUNCTIONS.search(probe)
    if match:
        raise SqlRejected(f"不允许调用函数 {match.group(0)}")
    return text


def wrap(sql: str, limit: int) -> str:
    return f"SELECT * FROM (\n{sql}\n) AS __query LIMIT {int(limit) + 1}"
