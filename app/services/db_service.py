"""数据库操作服务

封装所有对用户数据库的操作：表浏览、数据预览、SQL执行、DDL查看等。
"""

import re
from sqlalchemy import text, inspect
from typing import Optional


class DbService:
    """数据库操作服务"""

    def __init__(self, engine):
        self.engine = engine

    def list_databases(self) -> list[str]:
        """列出所有数据库"""
        dialect = self.engine.dialect.name
        with self.engine.connect() as conn:
            if dialect == "mysql":
                result = conn.execute(text("SHOW DATABASES"))
                return [row[0] for row in result if row[0] not in
                        ("information_schema", "mysql", "performance_schema", "sys")]
            elif dialect == "postgresql":
                result = conn.execute(
                    text("SELECT datname FROM pg_database WHERE datistemplate = false"))
                return [row[0] for row in result]
            else:
                # SQLite 只有一个数据库
                return ["main"]

    def list_tables(self, schema: Optional[str] = None) -> list[dict]:
        """列出指定数据库的所有表（含表注释）"""
        dialect = self.engine.dialect.name
        inspector = inspect(self.engine)
        tables = []

        # 获取表注释
        table_comments = {}
        if dialect == "mysql":
            try:
                with self.engine.connect() as conn:
                    db = schema or self.engine.url.database
                    result = conn.execute(text(
                        "SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES "
                        "WHERE TABLE_SCHEMA = :db AND TABLE_TYPE = 'BASE TABLE'"
                    ), {"db": db})
                    table_comments = {row[0]: row[1] for row in result}
            except Exception:
                pass
        elif dialect == "postgresql":
            try:
                with self.engine.connect() as conn:
                    pg_schema = schema or "public"
                    result = conn.execute(text(
                        "SELECT obj_description(c.oid) "
                        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = :schema"
                    ), {"schema": pg_schema})
                    # PostgreSQL 的表注释需要逐表获取，这里简化处理
            except Exception:
                pass

        table_names = inspector.get_table_names(schema=schema)
        for name in table_names:
            tables.append({
                "name": name,
                "type": "table",
                "comment": table_comments.get(name, ""),
            })

        # 也获取视图
        try:
            views = inspector.get_view_names(schema=schema)
            for name in views:
                tables.append({"name": name, "type": "view", "comment": ""})
        except Exception:
            pass
        return tables

    def describe_table(self, table_name: str, schema: Optional[str] = None) -> list[dict]:
        """获取表结构信息"""
        inspector = inspect(self.engine)
        columns = inspector.get_columns(table_name, schema=schema)

        result = []
        pk_info = inspector.get_pk_constraint(table_name, schema=schema)
        pk_columns = pk_info.get("constrained_columns", []) if pk_info else []

        fk_info = inspector.get_foreign_keys(table_name, schema=schema)

        for col in columns:
            col_info = {
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": col.get("nullable", True),
                "default": str(col.get("default", "")),
                "primary_key": col["name"] in pk_columns,
                "comment": col.get("comment", "") or "",
            }
            result.append(col_info)
        return result

    def get_table_sample(self, table_name: str, schema: Optional[str] = None,
                         limit: int = 200) -> dict:
        """获取表的样例数据"""
        # 安全处理表名（防止 SQL 注入）
        dialect = self.engine.dialect.name
        if dialect == "mysql":
            quoted = f"`{table_name}`"
        elif dialect == "postgresql":
            schema_prefix = f'"{schema}".' if schema else ""
            quoted = f'{schema_prefix}"{table_name}"'
        else:
            quoted = f'"{table_name}"'

        sql = f"SELECT * FROM {quoted} LIMIT {limit}"
        with self.engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]

        # 获取列元数据（注释、主键）用于前端展示和编辑
        try:
            columns_info = self.describe_table(table_name, schema)
            column_meta = [{"name": c["name"], "comment": c["comment"]}
                           for c in columns_info]
            pk_columns = [c["name"] for c in columns_info if c["primary_key"]]
        except Exception:
            column_meta = [{"name": c, "comment": ""} for c in columns]
            pk_columns = []

        return {
            "columns": columns,
            "rows": rows,
            "column_meta": column_meta,
            "primary_keys": pk_columns,
        }

    @staticmethod
    def _extract_table_name(sql: str) -> Optional[str]:
        """从简单 SELECT SQL 中提取表名（支持单表查询）"""
        # 匹配 SELECT ... FROM table_name 模式
        m = re.search(
            r'\bFROM\s+`?(\w+)`?(?:\s+(?:AS\s+)?\w+)?\s*(?:WHERE|GROUP|ORDER|LIMIT|HAVING|;|$)',
            sql.strip(), re.IGNORECASE | re.DOTALL
        )
        if m:
            # 排除子查询关键词
            name = m.group(1).strip('`"')
            if name.upper() not in ('SELECT', 'DUAL'):
                return name
        # 尝试更宽松的匹配：FROM table 后面直接结束
        m = re.search(r'\bFROM\s+`?(\w+)`?\s*$', sql.strip(), re.IGNORECASE)
        if m:
            return m.group(1).strip('`"')
        return None

    def execute_sql(self, sql: str, params: Optional[dict] = None) -> dict:
        """执行 SQL 语句"""
        with self.engine.connect() as conn:
            result = conn.execute(text(sql), params or {})

            # 判断是否是查询语句
            if result.returns_rows:
                columns = list(result.keys())
                rows = [list(row) for row in result.fetchall()]

                # 尝试获取列元数据和主键（用于显示注释和编辑）
                column_meta = []
                primary_keys = []
                table_name = self._extract_table_name(sql)
                if table_name:
                    try:
                        columns_info = self.describe_table(table_name)
                        column_meta = [{"name": c["name"], "comment": c["comment"]}
                                       for c in columns_info]
                        primary_keys = [c["name"] for c in columns_info if c["primary_key"]]
                    except Exception:
                        pass

                # 如果没拿到元数据，用空注释兜底
                if not column_meta:
                    column_meta = [{"name": c, "comment": ""} for c in columns]

                return {
                    "type": "query",
                    "columns": columns,
                    "rows": rows,
                    "rowcount": len(rows),
                    "column_meta": column_meta,
                    "primary_keys": primary_keys,
                    "tableName": table_name,
                }
            else:
                conn.commit()
                return {
                    "type": "execute",
                    "rowcount": result.rowcount,
                    "message": f"影响 {result.rowcount} 行",
                }

    def get_ddl(self, table_name: str, schema: Optional[str] = None) -> str:
        """获取建表语句"""
        dialect = self.engine.dialect.name
        with self.engine.connect() as conn:
            if dialect == "mysql":
                result = conn.execute(text(f"SHOW CREATE TABLE `{table_name}`"))
                row = result.fetchone()
                return row[1] if row else ""
            elif dialect == "postgresql":
                # PostgreSQL 需要使用 pg_dump 或手动构建
                result = conn.execute(text(
                    "SELECT pg_get_tabledef(:table_name)"))
                try:
                    row = result.fetchone()
                    return row[0] if row else ""
                except Exception:
                    return self._build_ddl_from_inspect(table_name, schema)
            else:
                return self._build_ddl_from_inspect(table_name, schema)

    def _build_ddl_from_inspect(self, table_name: str,
                                schema: Optional[str] = None) -> str:
        """通过 inspector 信息构建 DDL（备用方案）"""
        inspector = inspect(self.engine)
        columns = inspector.get_columns(table_name, schema=schema)
        pk = inspector.get_pk_constraint(table_name, schema=schema)

        lines = [f'CREATE TABLE "{table_name}" (']
        col_defs = []
        for col in columns:
            nullable = "" if col.get("nullable", True) else " NOT NULL"
            default = f" DEFAULT {col.get('default')}" if col.get("default") else ""
            col_defs.append(f'  "{col["name"]}" {col["type"]}{nullable}{default}')

        if pk and pk.get("constrained_columns"):
            cols = ", ".join(f'"{c}"' for c in pk["constrained_columns"])
            col_defs.append(f"  PRIMARY KEY ({cols})")

        lines.append(",\n".join(col_defs))
        lines.append(");")
        return "\n".join(lines)

    def get_row_count(self, table_name: str, schema: Optional[str] = None) -> int:
        """获取表行数"""
        dialect = self.engine.dialect.name
        if dialect == "mysql":
            quoted = f"`{table_name}`"
        elif dialect == "postgresql":
            schema_prefix = f'"{schema}".' if schema else ""
            quoted = f'{schema_prefix}"{table_name}"'
        else:
            quoted = f'"{table_name}"'

        with self.engine.connect() as conn:
            result = conn.execute(text(f"SELECT COUNT(*) FROM {quoted}"))
            return result.scalar()
