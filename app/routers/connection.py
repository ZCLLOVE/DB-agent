"""连接管理接口

数据库连接的 CRUD + 测试连接。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.models import ConnectionConfig, get_local_session
from app.database import db_manager

router = APIRouter(prefix="/api/connections", tags=["连接管理"])


class ConnectionCreate(BaseModel):
    name: str
    db_type: str  # mysql / postgresql / sqlite
    host: str = "localhost"
    port: int = 3306
    username: str = ""
    password: str = ""
    database: str


class ConnectionUpdate(BaseModel):
    name: str | None = None
    db_type: str | None = None
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    database: str | None = None


@router.get("")
def list_connections(session: Session = Depends(get_local_session)):
    """获取所有连接配置"""
    connections = session.query(ConnectionConfig).order_by(
        ConnectionConfig.updated_at.desc()
    ).all()
    return [c.to_dict() for c in connections]


@router.get("/{conn_id}")
def get_connection(conn_id: int, session: Session = Depends(get_local_session)):
    """获取单个连接配置"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")
    return conn.to_dict()


@router.post("")
def create_connection(data: ConnectionCreate,
                      session: Session = Depends(get_local_session)):
    """创建新连接"""
    conn = ConnectionConfig(**data.model_dump())
    session.add(conn)
    session.commit()
    session.refresh(conn)
    return conn.to_dict()


@router.put("/{conn_id}")
def update_connection(conn_id: int, data: ConnectionUpdate,
                      session: Session = Depends(get_local_session)):
    """更新连接配置"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(conn, key, value)

    # 如果关键连接参数变了，清除缓存的引擎
    if any(k in update_data for k in ("db_type", "host", "port", "database")):
        db_manager.remove_engine(conn)

    session.commit()
    session.refresh(conn)
    return conn.to_dict()


@router.delete("/{conn_id}")
def delete_connection(conn_id: int,
                      session: Session = Depends(get_local_session)):
    """删除连接"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")

    db_manager.remove_engine(conn)
    session.delete(conn)
    session.commit()
    return {"message": "删除成功"}


@router.post("/{conn_id}/test")
def test_connection(conn_id: int,
                    session: Session = Depends(get_local_session)):
    """测试连接"""
    conn = session.query(ConnectionConfig).get(conn_id)
    if not conn:
        raise HTTPException(404, "连接不存在")

    success, message = db_manager.test_connection(conn)
    return {"success": success, "message": message}
