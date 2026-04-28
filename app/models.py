"""本地存储模型

使用 SQLAlchemy 定义本地 SQLite 的表结构，存储连接配置和 SQL 执行历史。
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import LOCAL_DB_PATH

Base = declarative_base()


class ConnectionConfig(Base):
    """数据库连接配置"""
    __tablename__ = "connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, comment="连接名称")
    db_type = Column(String(20), nullable=False, comment="数据库类型: mysql/postgresql/sqlite")
    host = Column(String(255), default="localhost", comment="主机地址")
    port = Column(Integer, default=3306, comment="端口")
    username = Column(String(100), default="", comment="用户名")
    password = Column(String(500), default="", comment="密码")
    database = Column(String(200), nullable=False, comment="数据库名/SQLite文件路径")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        """转换为字典（密码脱敏）"""
        return {
            "id": self.id,
            "name": self.name,
            "db_type": self.db_type,
            "host": self.host,
            "port": self.port,
            "username": self.username,
            "password": self.password,
            "database": self.database,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AiProvider(Base):
    """AI 提供商配置"""
    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, comment="提供商名称")
    base_url = Column(String(500), nullable=False, comment="API Base URL")
    api_key = Column(String(500), default="", comment="API Key")
    model = Column(String(100), nullable=False, comment="模型名称")
    temperature = Column(Float, default=0.0, comment="Temperature")
    is_active = Column(Boolean, default=False, comment="是否当前激活")
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self, mask_key: bool = True) -> dict:
        """转换为字典"""
        key = self.api_key
        if mask_key and key:
            key = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
        return {
            "id": self.id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": key,
            "model": self.model,
            "temperature": self.temperature,
            "is_active": self.is_active,
        }


class SqlHistory(Base):
    """SQL 执行历史"""
    __tablename__ = "sql_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    connection_id = Column(Integer, nullable=False, comment="关联的连接ID")
    sql = Column(Text, nullable=False, comment="执行的SQL")
    status = Column(String(20), default="success", comment="执行状态: success/error")
    rows_affected = Column(Integer, default=0, comment="影响行数")
    error_message = Column(Text, default="", comment="错误信息")
    executed_at = Column(DateTime, default=datetime.now)


class ChatSession(Base):
    """AI 对话会话"""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), default="新会话", comment="会话标题")
    connection_id = Column(Integer, nullable=True, comment="关联的连接ID")
    messages = Column(Text, default="[]", comment="消息记录 JSON")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "connection_id": self.connection_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "message_count": len(self.get_messages()),
        }

    def get_messages(self) -> list:
        import json
        try:
            return json.loads(self.messages or "[]")
        except Exception:
            return []

    def set_messages(self, msgs: list):
        import json
        self.messages = json.dumps(msgs, ensure_ascii=False)


# 初始化本地数据库
_local_engine = create_engine(f"sqlite:///{LOCAL_DB_PATH}", echo=False)
LocalSession = sessionmaker(bind=_local_engine)


def init_local_db():
    """初始化本地数据库表"""
    Base.metadata.create_all(_local_engine)


def get_local_session():
    """获取本地数据库会话"""
    session = LocalSession()
    try:
        yield session
    finally:
        session.close()
