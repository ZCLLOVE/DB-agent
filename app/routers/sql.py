"""SQL 执行接口

手动执行 SQL、查询历史记录。
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import ConnectionConfig, SqlHistory, get_local_session
from app.database import db_manager
from app.services.db_service import DbService

router = APIRouter(prefix="/api", tags=["SQL执行"])


class SqlExecuteRequest(BaseModel):
    sql: str
    # 是否已确认（写操作需要前端确认）
    confirmed: bool = False


def _is_write_sql(sql: str) -> bool:
    """判断是否是写操作（INSERT/UPDATE/DELETE/DDL）"""
    sql_upper = sql.strip().upper()
    write_keywords = ("INSERT", "UPDATE", "DELETE", "DROP", "CREATE",
                      "ALTER", "TRUNCATE", "REPLACE")
    return any(sql_upper.startswith(kw) for kw in write_keywords)


@router.post("/connections/{conn_id}/sql")
def execute_sql(conn_id: int, req: SqlExecuteRequest,
                session: Session = Depends(get_local_session)):
    """执行 SQL"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")

    # 写操作需要确认
    if _is_write_sql(req.sql) and not req.confirmed:
        return {
            "type": "confirm_required",
            "sql": req.sql,
            "message": "该 SQL 为写操作，请确认后执行",
        }

    engine = db_manager.get_engine(conn)
    service = DbService(engine)

    # 记录到历史
    history = SqlHistory(
        connection_id=conn_id,
        sql=req.sql,
    )

    try:
        result = service.execute_sql(req.sql)
        history.status = "success"
        history.rows_affected = result.get("rowcount", 0)
        return result
    except Exception as e:
        history.status = "error"
        history.error_message = str(e)
        raise HTTPException(400, f"SQL 执行错误: {str(e)}")
    finally:
        session.add(history)
        session.commit()


@router.get("/connections/{conn_id}/sql-history")
def get_sql_history(conn_id: int,
                    limit: int = Query(50, ge=1, le=200),
                    session: Session = Depends(get_local_session)):
    """获取 SQL 执行历史"""
    records = session.query(SqlHistory).filter(
        SqlHistory.connection_id == conn_id
    ).order_by(SqlHistory.executed_at.desc()).limit(limit).all()

    return [{
        "id": r.id,
        "sql": r.sql,
        "status": r.status,
        "rows_affected": r.rows_affected,
        "error_message": r.error_message,
        "executed_at": r.executed_at.isoformat() if r.executed_at else None,
    } for r in records]
