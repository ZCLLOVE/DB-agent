"""AI Agent 工具定义

定义数据库操作工具，使用 OpenAI function calling 格式。
工具实现为普通函数，由 ai_service.py 调用。
"""

from typing import Optional
from app.database import db_manager
from app.models import ConnectionConfig


def _get_service(connection_id: int):
    """根据连接ID获取 DbService 实例"""
    from app.models import LocalSession
    session = LocalSession()
    try:
        conn = session.query(ConnectionConfig).get(connection_id)
        if not conn:
            raise ValueError(f"连接不存在: {connection_id}")
        engine = db_manager.get_engine(conn)
        from app.services.db_service import DbService
        return DbService(engine), conn
    finally:
        session.close()


# ==================== 工具实现 ====================

def _list_databases(connection_id: int) -> str:
    service, _ = _get_service(connection_id)
    databases = service.list_databases()
    return f"数据库列表: {', '.join(databases)}"


def _list_tables(connection_id: int, db_schema: Optional[str] = None) -> str:
    service, _ = _get_service(connection_id)
    tables = service.list_tables(db_schema)
    if not tables:
        return "当前没有找到任何表。"
    table_info = [f"- {t['name']} ({t['type']})" for t in tables]
    return "表列表:\n" + "\n".join(table_info)


def _describe_table(connection_id: int, table_name: str,
                    db_schema: Optional[str] = None) -> str:
    service, _ = _get_service(connection_id)
    columns = service.describe_table(table_name, db_schema)
    if not columns:
        return f"表 '{table_name}' 不存在或没有列信息。"
    lines = [f"表 '{table_name}' 结构:"]
    for col in columns:
        pk_mark = " [PK]" if col["primary_key"] else ""
        nullable = "NULL" if col["nullable"] else "NOT NULL"
        comment = f" -- {col['comment']}" if col["comment"] else ""
        lines.append(f"  {col['name']}: {col['type']} {nullable}{pk_mark}{comment}")
    return "\n".join(lines)


def _get_table_sample(connection_id: int, table_name: str,
                      db_schema: Optional[str] = None, limit: int = 5) -> str:
    service, _ = _get_service(connection_id)
    data = service.get_table_sample(table_name, db_schema, limit=limit)
    if not data["rows"]:
        return f"表 '{table_name}' 没有数据。"

    columns = data["columns"]
    lines = [f"表 '{table_name}' 样例数据 (前{len(data['rows'])}行):"]
    col_widths = [len(str(c)) for c in columns]
    for row in data["rows"]:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(val or "NULL")))
    header = " | ".join(str(c).ljust(col_widths[i]) for i, c in enumerate(columns))
    lines.append(header)
    lines.append("-" * len(header))
    for row in data["rows"]:
        line = " | ".join(str(val or "NULL").ljust(col_widths[i]) for i, val in enumerate(row))
        lines.append(line)
    return "\n".join(lines)


def _execute_sql(connection_id: int, sql: str) -> str:
    service, _ = _get_service(connection_id)

    # 判断是否写操作
    sql_upper = sql.strip().upper()
    is_write = any(sql_upper.startswith(kw) for kw in
                   ("INSERT", "UPDATE", "DELETE", "DROP", "CREATE",
                    "ALTER", "TRUNCATE", "REPLACE"))

    try:
        result = service.execute_sql(sql)
    except Exception as e:
        # 写操作记录失败历史
        if is_write:
            _save_history(connection_id, sql, status="error", error=str(e))
        raise

    # 写操作记录成功历史
    if is_write:
        _save_history(connection_id, sql, status="success",
                      rows_affected=result.get("rowcount", 0))

    if result["type"] == "query":
        columns = result["columns"]
        rows = result["rows"]
        if not rows:
            return "查询结果为空。"
        lines = [f"查询返回 {len(rows)} 行:"]
        col_widths = [len(str(c)) for c in columns]
        for row in rows[:20]:
            for i, val in enumerate(row):
                col_widths[i] = max(col_widths[i], len(str(val or "NULL")[:50]))
        header = " | ".join(str(c).ljust(col_widths[i]) for i, c in enumerate(columns))
        lines.append(header)
        lines.append("-" * len(header))
        for row in rows[:20]:
            line = " | ".join(
                str(val or "NULL")[:50].ljust(col_widths[i]) for i, val in enumerate(row)
            )
            lines.append(line)
        if len(rows) > 20:
            lines.append(f"... 还有 {len(rows) - 20} 行")
        return "\n".join(lines)
    else:
        return result["message"]


def _save_history(connection_id: int, sql: str, status: str = "success",
                  rows_affected: int = 0, error: str = ""):
    """记录 SQL 执行历史"""
    from app.models import SqlHistory, LocalSession
    session = LocalSession()
    try:
        history = SqlHistory(
            connection_id=connection_id,
            sql=sql,
            status=status,
            rows_affected=rows_affected,
            error_message=error,
        )
        session.add(history)
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()


# ==================== 工具注册表（OpenAI function calling 格式）====================

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_databases",
            "description": "列出所有数据库",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "integer", "description": "连接ID"},
                },
                "required": ["connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": "列出指定数据库的所有表",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "integer", "description": "连接ID"},
                    "db_schema": {"type": "string", "description": "数据库/模式名（可选）"},
                },
                "required": ["connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_table",
            "description": "查看表结构（字段名、类型、注释等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "integer", "description": "连接ID"},
                    "table_name": {"type": "string", "description": "表名"},
                    "db_schema": {"type": "string", "description": "模式名（可选）"},
                },
                "required": ["connection_id", "table_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_table_sample",
            "description": "获取表的样例数据",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "integer", "description": "连接ID"},
                    "table_name": {"type": "string", "description": "表名"},
                    "limit": {"type": "integer", "description": "返回行数，默认5"},
                    "db_schema": {"type": "string", "description": "模式名（可选）"},
                },
                "required": ["connection_id", "table_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_sql",
            "description": "执行 SQL 语句并返回结果。注意: 写操作(INSERT/UPDATE/DELETE/DDL)需谨慎。",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "integer", "description": "连接ID"},
                    "sql": {"type": "string", "description": "要执行的SQL语句"},
                },
                "required": ["connection_id", "sql"],
            },
        },
    },
]

# 工具名 -> 实现函数 的映射
TOOL_FUNCTIONS = {
    "list_databases": _list_databases,
    "list_tables": _list_tables,
    "describe_table": _describe_table,
    "get_table_sample": _get_table_sample,
    "execute_sql": _execute_sql,
}
