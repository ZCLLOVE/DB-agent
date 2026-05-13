"""表浏览接口

提供数据库/表/字段浏览、DDL预览、数据预览等功能。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models import ConnectionConfig, get_local_session
from app.database import db_manager
from app.services.db_service import DbService

router = APIRouter(prefix="/api", tags=["表浏览"])


def _get_conn_and_service(conn_id: int, session: Session):
    """获取连接配置和 DbService"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")
    engine = db_manager.get_engine(conn)
    return conn, DbService(engine)


@router.get("/connections/{conn_id}/databases")
def list_databases(conn_id: int, session: Session = Depends(get_local_session)):
    """列出所有数据库"""
    conn, service = _get_conn_and_service(conn_id, session)
    databases = service.list_databases()
    return {"databases": databases}


@router.get("/connections/{conn_id}/tables")
def list_tables(conn_id: int, schema: str | None = Query(None),
                session: Session = Depends(get_local_session)):
    """列出所有表"""
    conn, service = _get_conn_and_service(conn_id, session)
    tables = service.list_tables(schema)
    return {"tables": tables}


@router.get("/connections/{conn_id}/tables/{table_name}/columns")
def describe_table(conn_id: int, table_name: str,
                   schema: str | None = Query(None),
                   session: Session = Depends(get_local_session)):
    """查看表结构"""
    conn, service = _get_conn_and_service(conn_id, session)
    columns = service.describe_table(table_name, schema)
    return {"columns": columns}


@router.get("/connections/{conn_id}/tables/{table_name}/data")
def get_table_data(conn_id: int, table_name: str,
                   schema: str | None = Query(None),
                   limit: int = Query(200, ge=1, le=1000),
                   offset: int = Query(0, ge=0),
                   session: Session = Depends(get_local_session)):
    """获取表数据（分页）"""
    conn, service = _get_conn_and_service(conn_id, session)
    data = service.get_table_sample(table_name, schema, limit)
    return data


@router.get("/connections/{conn_id}/tables/{table_name}/ddl")
def get_ddl(conn_id: int, table_name: str,
            schema: str | None = Query(None),
            session: Session = Depends(get_local_session)):
    """查看建表语句"""
    conn, service = _get_conn_and_service(conn_id, session)
    ddl = service.get_ddl(table_name, schema)
    return {"ddl": ddl}


@router.get("/connections/{conn_id}/tables/{table_name}/count")
def get_row_count(conn_id: int, table_name: str,
                  schema: str | None = Query(None),
                  session: Session = Depends(get_local_session)):
    """获取表行数"""
    conn, service = _get_conn_and_service(conn_id, session)
    count = service.get_row_count(table_name, schema)
    return {"count": count}


@router.get("/connections/{conn_id}/tables/{table_name}/constraints")
def get_constraints_and_indexes(conn_id: int, table_name: str,
                                 schema: str | None = Query(None),
                                 session: Session = Depends(get_local_session)):
    """查看表的约束和索引"""
    conn, service = _get_conn_and_service(conn_id, session)
    data = service.get_constraints_and_indexes(table_name, schema)
    return data
