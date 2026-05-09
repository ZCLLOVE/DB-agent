"""AI Agent 工具定义

定义数据库操作工具和 HTTP 请求工具，使用 OpenAI function calling 格式。
工具实现为普通函数，由 ai_service.py 调用。
"""

import json
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


# ==================== HTTP 工具实现 ====================

def _http_request(method: str, url: str, headers: Optional[dict] = None,
                  params: Optional[dict] = None, body_type: str = "json",
                  body: Optional[str] = None, description: str = "") -> str:
    """同步包装：发送 HTTP 请求"""
    import asyncio
    from app.services.http_service import send_request

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(asyncio.run, send_request(
                    method=method, url=url, headers=headers or {},
                    params=params or {}, body_type=body_type or "none",
                    body_raw=body or "",
                )).result()
        else:
            result = loop.run_until_complete(send_request(
                method=method, url=url, headers=headers or {},
                params=params or {}, body_type=body_type or "none",
                body_raw=body or "",
            ))
    except Exception as e:
        return f"请求执行错误: {str(e)}"

    if result.get("error"):
        return f"请求失败: {result['error']}"

    # 格式化输出
    status = result["status_code"]
    elapsed = result["elapsed_ms"]
    body_preview = result.get("body", "")[:3000]

    status_emoji = "✅" if 200 <= status < 300 else "⚠️" if 300 <= status < 400 else "❌"

    lines = [
        f"{status_emoji} {method.upper()} {url}",
        f"状态码: {status} | 耗时: {elapsed}ms",
        f"响应体:\n{body_preview}",
    ]
    return "\n".join(lines)


def _save_api_request(name: str, method: str, url: str,
                      collection_name: str = "默认集合",
                      headers: Optional[dict] = None,
                      body: Optional[str] = None,
                      body_type: str = "json") -> str:
    """保存请求到集合"""
    from app.models import ApiCollection, ApiRequest, LocalSession
    session = LocalSession()
    try:
        # 查找或创建集合
        coll = session.query(ApiCollection).filter(
            ApiCollection.name == collection_name
        ).first()
        if not coll:
            coll = ApiCollection(name=collection_name)
            session.add(coll)
            session.commit()
            session.refresh(coll)

        req = ApiRequest(
            collection_id=coll.id,
            name=name,
            method=method.upper(),
            url=url,
            headers=json.dumps(headers or {}, ensure_ascii=False),
            body_type=body_type,
            body_raw=body or "",
        )
        session.add(req)
        session.commit()
        return f"已保存请求 '{name}' 到集合 '{collection_name}'"
    except Exception as e:
        session.rollback()
        return f"保存失败: {str(e)}"
    finally:
        session.close()


def _list_api_collections() -> str:
    """列出所有接口集合及其请求（树形展示）"""
    from app.models import ApiCollection, ApiRequest, LocalSession
    session = LocalSession()
    try:
        collections = session.query(ApiCollection).order_by(ApiCollection.sort_order, ApiCollection.id).all()
        if not collections:
            return "当前没有任何集合。"

        # 构建树
        coll_map = {c.id: c for c in collections}
        reqs_by_coll = {}
        for coll in collections:
            reqs_by_coll[coll.id] = session.query(ApiRequest).filter(
                ApiRequest.collection_id == coll.id
            ).all()

        lines = ["接口集合列表:"]

        def render_tree(parent_id, depth):
            children = [c for c in collections if c.parent_id == parent_id]
            for coll in children:
                reqs = reqs_by_coll.get(coll.id, [])
                indent = "  " * depth
                parent_info = ""
                if coll.parent_id and coll.parent_id in coll_map:
                    parent_info = f" (父集合: {coll_map[coll.parent_id].name})"
                lines.append(f"{indent}📁 {coll.name} ({len(reqs)} 个请求){parent_info}")
                for req in reqs:
                    lines.append(f"{indent}  - {req.method} {req.name}: {req.url}")
                    if req.body_raw:
                        preview = req.body_raw[:100]
                        lines.append(f"{indent}    请求体: {preview}{'...' if len(req.body_raw) > 100 else ''}")
                render_tree(coll.id, depth + 1)

        render_tree(None, 0)
        return "\n".join(lines)
    except Exception as e:
        return f"查询失败: {str(e)}"
    finally:
        session.close()


def _get_api_request(name: Optional[str] = None, collection_name: Optional[str] = None) -> str:
    """根据名称或集合查询保存的接口请求"""
    from app.models import ApiCollection, ApiRequest, LocalSession
    session = LocalSession()
    try:
        query = session.query(ApiRequest)

        if collection_name:
            coll = session.query(ApiCollection).filter(
                ApiCollection.name == collection_name
            ).first()
            if not coll:
                return f"集合 '{collection_name}' 不存在"
            query = query.filter(ApiRequest.collection_id == coll.id)

        if name:
            query = query.filter(ApiRequest.name.contains(name))

        reqs = query.all()
        if not reqs:
            return "未找到匹配的请求"

        lines = [f"找到 {len(reqs)} 个请求:"]
        for req in reqs:
            coll = session.query(ApiCollection).get(req.collection_id)
            coll_name = coll.name if coll else "未知集合"
            headers = json.loads(req.headers or "{}")
            lines.append(f"\n📌 {req.name} (集合: {coll_name})")
            lines.append(f"  方法: {req.method}")
            lines.append(f"  URL: {req.url}")
            if headers:
                lines.append(f"  请求头: {json.dumps(headers, ensure_ascii=False)}")
            if req.body_raw:
                lines.append(f"  请求体: {req.body_raw[:500]}")
        return "\n".join(lines)
    except Exception as e:
        return f"查询失败: {str(e)}"
    finally:
        session.close()


def _update_api_request(name: str, new_name: Optional[str] = None,
                        method: Optional[str] = None, url: Optional[str] = None,
                        headers: Optional[dict] = None, body: Optional[str] = None,
                        body_type: Optional[str] = None,
                        collection_name: Optional[str] = None) -> str:
    """更新已保存的接口请求"""
    from app.models import ApiCollection, ApiRequest, LocalSession
    session = LocalSession()
    try:
        req = session.query(ApiRequest).filter(ApiRequest.name.contains(name)).first()
        if not req:
            return f"未找到名称包含 '{name}' 的请求"

        if new_name:
            req.name = new_name
        if method:
            req.method = method.upper()
        if url:
            req.url = url
        if headers is not None:
            req.headers = json.dumps(headers, ensure_ascii=False)
        if body is not None:
            req.body_raw = body
        if body_type:
            req.body_type = body_type
        if collection_name:
            coll = session.query(ApiCollection).filter(
                ApiCollection.name == collection_name
            ).first()
            if coll:
                req.collection_id = coll.id
            else:
                return f"集合 '{collection_name}' 不存在"

        session.commit()
        return f"已更新请求 '{req.name}' (方法: {req.method}, URL: {req.url})"
    except Exception as e:
        session.rollback()
        return f"更新失败: {str(e)}"
    finally:
        session.close()


def _delete_api_request(name: str) -> str:
    """删除已保存的接口请求"""
    from app.models import ApiRequest, LocalSession
    session = LocalSession()
    try:
        reqs = session.query(ApiRequest).filter(ApiRequest.name.contains(name)).all()
        if not reqs:
            return f"未找到名称包含 '{name}' 的请求"
        if len(reqs) > 1:
            names = [r.name for r in reqs]
            return f"找到多个匹配的请求: {', '.join(names)}，请提供更精确的名称"

        req = reqs[0]
        req_name = req.name
        session.delete(req)
        session.commit()
        return f"已删除请求 '{req_name}'"
    except Exception as e:
        session.rollback()
        return f"删除失败: {str(e)}"
    finally:
        session.close()


def _delete_api_collection(name: str) -> str:
    """删除接口集合及其下所有请求"""
    from app.models import ApiCollection, ApiRequest, LocalSession
    session = LocalSession()
    try:
        coll = session.query(ApiCollection).filter(
            ApiCollection.name.contains(name)
        ).first()
        if not coll:
            return f"未找到名称包含 '{name}' 的集合"

        # 递归收集所有后代集合 ID
        def collect_descendants(pid):
            ids = [pid]
            children = session.query(ApiCollection).filter(ApiCollection.parent_id == pid).all()
            for child in children:
                ids.extend(collect_descendants(child.id))
            return ids

        desc_ids = collect_descendants(coll.id)
        total_reqs = session.query(ApiRequest).filter(
            ApiRequest.collection_id.in_(desc_ids)
        ).count()

        # 先删请求再删集合
        session.query(ApiRequest).filter(ApiRequest.collection_id.in_(desc_ids)).delete(synchronize_session=False)
        session.query(ApiCollection).filter(ApiCollection.id.in_(desc_ids)).delete(synchronize_session=False)
        session.commit()
        return f"已删除集合 '{coll.name}' 及其 {len(desc_ids)} 个子集合，共 {total_reqs} 个请求"
    except Exception as e:
        session.rollback()
        return f"删除失败: {str(e)}"
    finally:
        session.close()


def _update_api_collection(name: str, new_name: Optional[str] = None,
                           parent_name: Optional[str] = None,
                           move_to_top: bool = False) -> str:
    """修改集合名称或移动集合到其他集合下/顶级"""
    from app.models import ApiCollection, LocalSession
    session = LocalSession()
    try:
        coll = session.query(ApiCollection).filter(
            ApiCollection.name.contains(name)
        ).first()
        if not coll:
            return f"未找到名称包含 '{name}' 的集合"

        changes = []

        # 修改名称
        if new_name:
            changes.append(f"名称: '{coll.name}' -> '{new_name}'")
            coll.name = new_name

        # 移动位置
        if move_to_top:
            changes.append(f"移动到顶级集合")
            coll.parent_id = None
        elif parent_name is not None:
            # parent_name 为空字符串时也表示移到顶级
            if parent_name == "":
                changes.append(f"移动到顶级集合")
                coll.parent_id = None
            else:
                parent = session.query(ApiCollection).filter(
                    ApiCollection.name.contains(parent_name)
                ).first()
                if not parent:
                    return f"未找到名称包含 '{parent_name}' 的目标集合"
                if parent.id == coll.id:
                    return "不能将集合移动到自身下面"
                # 检查是否会形成循环（目标不能是当前集合的后代）
                desc_ids = set()
                def collect_desc(pid):
                    for c in session.query(ApiCollection).filter(ApiCollection.parent_id == pid).all():
                        desc_ids.add(c.id)
                        collect_desc(c.id)
                collect_desc(coll.id)
                if parent.id in desc_ids:
                    return f"不能将集合移动到其子集合 '{parent.name}' 下面，会形成循环"
                changes.append(f"移动到集合 '{parent.name}' 下面")
                coll.parent_id = parent.id

        if not changes:
            return "未指定任何修改操作，请提供 new_name、parent_name 或 move_to_top 参数"

        session.commit()
        return f"已更新集合: " + "，".join(changes)
    except Exception as e:
        session.rollback()
        return f"更新失败: {str(e)}"
    finally:
        session.close()


# ==================== 环境变量工具 ====================

def _list_api_environments() -> str:
    """列出所有环境变量配置"""
    from app.models import ApiEnvironment, LocalSession
    session = LocalSession()
    try:
        envs = session.query(ApiEnvironment).all()
        if not envs:
            return "当前没有任何环境变量配置。"

        lines = ["环境变量列表:"]
        for env in envs:
            variables = json.loads(env.variables or "{}")
            active_mark = " [当前激活]" if env.is_active else ""
            lines.append(f"\n🌍 {env.name}{active_mark}")
            if variables:
                for k, v in variables.items():
                    lines.append(f"  {k} = {v}")
            else:
                lines.append("  (无变量)")
        return "\n".join(lines)
    except Exception as e:
        return f"查询失败: {str(e)}"
    finally:
        session.close()


def _create_api_environment(name: str, variables: Optional[dict] = None) -> str:
    """创建新的环境变量配置"""
    from app.models import ApiEnvironment, LocalSession
    session = LocalSession()
    try:
        existing = session.query(ApiEnvironment).filter(
            ApiEnvironment.name == name
        ).first()
        if existing:
            return f"环境 '{name}' 已存在，如需修改请使用更新功能"

        env = ApiEnvironment(
            name=name,
            variables=json.dumps(variables or {}, ensure_ascii=False),
        )
        session.add(env)
        session.commit()
        var_count = len(variables) if variables else 0
        return f"已创建环境 '{name}'，包含 {var_count} 个变量"
    except Exception as e:
        session.rollback()
        return f"创建失败: {str(e)}"
    finally:
        session.close()


def _update_api_environment(name: str, new_name: Optional[str] = None,
                            variables: Optional[dict] = None,
                            merge_variables: bool = False) -> str:
    """更新环境变量配置。merge_variables=True 时合并变量而非替换"""
    from app.models import ApiEnvironment, LocalSession
    session = LocalSession()
    try:
        env = session.query(ApiEnvironment).filter(
            ApiEnvironment.name.contains(name)
        ).first()
        if not env:
            return f"未找到名称包含 '{name}' 的环境"

        if new_name:
            env.name = new_name
        if variables is not None:
            if merge_variables:
                existing = json.loads(env.variables or "{}")
                existing.update(variables)
                env.variables = json.dumps(existing, ensure_ascii=False)
            else:
                env.variables = json.dumps(variables, ensure_ascii=False)

        session.commit()
        final_vars = json.loads(env.variables or "{}")
        return f"已更新环境 '{env.name}'，当前有 {len(final_vars)} 个变量"
    except Exception as e:
        session.rollback()
        return f"更新失败: {str(e)}"
    finally:
        session.close()


def _delete_api_environment(name: str) -> str:
    """删除环境变量配置"""
    from app.models import ApiEnvironment, LocalSession
    session = LocalSession()
    try:
        env = session.query(ApiEnvironment).filter(
            ApiEnvironment.name.contains(name)
        ).first()
        if not env:
            return f"未找到名称包含 '{name}' 的环境"

        env_name = env.name
        session.delete(env)
        session.commit()
        return f"已删除环境 '{env_name}'"
    except Exception as e:
        session.rollback()
        return f"删除失败: {str(e)}"
    finally:
        session.close()


# ==================== 追加 HTTP 工具定义 ====================

HTTP_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "http_request",
            "description": "发送 HTTP 请求到指定 URL，支持 GET/POST/PUT/DELETE/PATCH 等方法",
            "parameters": {
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
                        "description": "HTTP 请求方法",
                    },
                    "url": {
                        "type": "string",
                        "description": "完整的请求 URL",
                    },
                    "headers": {
                        "type": "object",
                        "description": "请求头，如 {\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer xxx\"}",
                    },
                    "params": {
                        "type": "object",
                        "description": "URL 查询参数",
                    },
                    "body_type": {
                        "type": "string",
                        "enum": ["none", "json", "form", "raw", "xml"],
                        "description": "请求体类型，默认 json",
                    },
                    "body": {
                        "type": "string",
                        "description": "请求体内容（JSON 字符串或原始文本）",
                    },
                    "description": {
                        "type": "string",
                        "description": "本次请求的用途说明",
                    },
                },
                "required": ["method", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_api_request",
            "description": "将接口请求保存到集合中，方便后续复用",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "请求名称，如 '登录接口'",
                    },
                    "method": {
                        "type": "string",
                        "description": "HTTP 方法",
                    },
                    "url": {
                        "type": "string",
                        "description": "请求 URL",
                    },
                    "collection_name": {
                        "type": "string",
                        "description": "集合名称，默认 '默认集合'",
                    },
                    "headers": {
                        "type": "object",
                        "description": "请求头",
                    },
                    "body": {
                        "type": "string",
                        "description": "请求体",
                    },
                    "body_type": {
                        "type": "string",
                        "description": "请求体类型",
                    },
                },
                "required": ["name", "method", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_api_collections",
            "description": "列出所有接口集合及其中的请求，查看已保存的接口列表",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_api_request",
            "description": "根据名称或集合查询已保存的接口请求详情",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "请求名称（支持模糊匹配）",
                    },
                    "collection_name": {
                        "type": "string",
                        "description": "集合名称（可选，用于按集合筛选）",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_api_request",
            "description": "更新已保存的接口请求（修改名称、URL、方法、请求体等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要更新的请求名称（模糊匹配）",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "新名称（可选）",
                    },
                    "method": {
                        "type": "string",
                        "description": "新的 HTTP 方法（可选）",
                    },
                    "url": {
                        "type": "string",
                        "description": "新的 URL（可选）",
                    },
                    "headers": {
                        "type": "object",
                        "description": "新的请求头（可选）",
                    },
                    "body": {
                        "type": "string",
                        "description": "新的请求体（可选）",
                    },
                    "body_type": {
                        "type": "string",
                        "description": "新的请求体类型（可选）",
                    },
                    "collection_name": {
                        "type": "string",
                        "description": "移动到指定集合（可选）",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_api_request",
            "description": "删除已保存的接口请求",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要删除的请求名称（模糊匹配）",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_api_collection",
            "description": "修改集合名称或将集合移动到其他集合下面/移到顶级。支持集合的层级管理。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要修改的集合名称（模糊匹配）",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "新名称（可选）",
                    },
                    "parent_name": {
                        "type": "string",
                        "description": "移动到指定名称的集合下面（模糊匹配）。设为空字符串表示移到顶级。",
                    },
                    "move_to_top": {
                        "type": "boolean",
                        "description": "true 时移动到顶级（无父集合），默认 false",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_api_collection",
            "description": "删除接口集合及其下所有请求和子集合",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要删除的集合名称（模糊匹配）",
                    },
                },
                "required": ["name"],
            },
        },
    },
    # ===== 环境变量工具 =====
    {
        "type": "function",
        "function": {
            "name": "list_api_environments",
            "description": "列出所有环境变量配置及其中的变量",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_api_environment",
            "description": "创建新的环境变量配置，可指定变量键值对",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "环境名称，如 '开发环境'、'测试环境'",
                    },
                    "variables": {
                        "type": "object",
                        "description": "变量键值对，如 {\"base_url\": \"https://api.dev.com\", \"token\": \"xxx\"}",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_api_environment",
            "description": "更新环境变量配置（改名、修改变量）。merge_variables=True 时合并而非替换",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要更新的环境名称（模糊匹配）",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "新名称（可选）",
                    },
                    "variables": {
                        "type": "object",
                        "description": "新的变量键值对",
                    },
                    "merge_variables": {
                        "type": "boolean",
                        "description": "true=合并到现有变量，false=完全替换（默认 false）",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_api_environment",
            "description": "删除环境变量配置",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "要删除的环境名称（模糊匹配）",
                    },
                },
                "required": ["name"],
            },
        },
    },
]

# HTTP 工具名 -> 实现函数
HTTP_TOOL_FUNCTIONS = {
    "http_request": _http_request,
    "save_api_request": _save_api_request,
    "list_api_collections": _list_api_collections,
    "get_api_request": _get_api_request,
    "update_api_request": _update_api_request,
    "delete_api_request": _delete_api_request,
    "delete_api_collection": _delete_api_collection,
    "update_api_collection": _update_api_collection,
    "list_api_environments": _list_api_environments,
    "create_api_environment": _create_api_environment,
    "update_api_environment": _update_api_environment,
    "delete_api_environment": _delete_api_environment,
}
