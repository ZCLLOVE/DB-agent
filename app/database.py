"""数据库连接池管理模块

管理用户数据库（MySQL/PostgreSQL/SQLite）的连接，使用 SQLAlchemy Engine 实现连接池。
"""

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import Engine
from typing import Optional
from urllib.parse import quote_plus
import threading

from app.models import ConnectionConfig


class DatabaseManager:
    """数据库连接管理器，缓存 SQLAlchemy Engine 实例"""

    def __init__(self):
        self._engines: dict[str, Engine] = {}
        self._lock = threading.Lock()

    def _build_url(self, conn: ConnectionConfig) -> str:
        """根据连接配置构建数据库 URL（对用户名密码做 URL 编码，防止特殊字符破坏解析）"""
        user = quote_plus(conn.username or "")
        pwd = quote_plus(conn.password or "")
        if conn.db_type == "mysql":
            return (
                f"mysql+pymysql://{user}:{pwd}"
                f"@{conn.host}:{conn.port}/{conn.database}"
            )
        elif conn.db_type == "postgresql":
            return (
                f"postgresql+psycopg2://{user}:{pwd}"
                f"@{conn.host}:{conn.port}/{conn.database}"
            )
        elif conn.db_type == "sqlite":
            return f"sqlite:///{conn.database}"
        else:
            raise ValueError(f"不支持的数据库类型: {conn.db_type}")

    def get_engine(self, conn: ConnectionConfig) -> Engine:
        """获取或创建数据库引擎（带缓存）"""
        cache_key = f"{conn.db_type}:{conn.host}:{conn.port}:{conn.database}"

        with self._lock:
            if cache_key in self._engines:
                return self._engines[cache_key]

            url = self._build_url(conn)
            # SQLite 不需要连接池，但需要 check_same_thread=False
            pool_kwargs = (
                {"connect_args": {"check_same_thread": False}}
                if conn.db_type == "sqlite" else {
                    "pool_size": 5,
                    "max_overflow": 10,
                    "pool_recycle": 3600,
                    "pool_pre_ping": True,
                }
            )
            engine = create_engine(url, **pool_kwargs)
            self._engines[cache_key] = engine
            return engine

    def test_connection(self, conn: ConnectionConfig) -> tuple[bool, str]:
        """测试连接是否可用"""
        try:
            engine = self.get_engine(conn)
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True, "连接成功"
        except Exception as e:
            # 连接失败时清除缓存
            cache_key = f"{conn.db_type}:{conn.host}:{conn.port}:{conn.database}"
            with self._lock:
                self._engines.pop(cache_key, None)
            return False, f"连接失败: {str(e)}"

    def remove_engine(self, conn: ConnectionConfig):
        """移除并释放指定连接的引擎"""
        cache_key = f"{conn.db_type}:{conn.host}:{conn.port}:{conn.database}"
        with self._lock:
            engine = self._engines.pop(cache_key, None)
            if engine:
                engine.dispose()

    def close_all(self):
        """关闭所有连接"""
        with self._lock:
            for engine in self._engines.values():
                engine.dispose()
            self._engines.clear()


# 全局单例
db_manager = DatabaseManager()
