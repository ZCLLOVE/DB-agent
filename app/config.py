"""配置管理模块"""

import json
import sys
from pathlib import Path


def get_base_dir():
    """获取项目根目录（用于数据存储）"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后的环境，使用 exe 所在目录
        return Path(sys.executable).parent
    else:
        # 开发环境，使用项目根目录
        return Path(__file__).resolve().parent.parent


def get_resource_dir():
    """获取资源文件目录（模板和静态文件）"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后，资源文件在 _internal 目录（PyInstaller 5.0+）
        # 或者在 sys._MEIPASS（老版本）
        base = Path(sys.executable).parent / "_internal"
        if base.exists():
            return base
        # 兼容老版本 PyInstaller
        if hasattr(sys, '_MEIPASS'):
            return Path(sys._MEIPASS)
        # 降级到 exe 同级目录
        return Path(sys.executable).parent
    else:
        # 开发环境，使用项目根目录
        return Path(__file__).resolve().parent.parent


# 项目根目录（用于数据存储）
BASE_DIR = get_base_dir()

# 本地存储目录（用户数据）
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 本地 SQLite 数据库路径（存储连接配置、SQL历史等）
LOCAL_DB_PATH = DATA_DIR / "dbagent.db"

# 模板和静态文件目录
RESOURCE_DIR = get_resource_dir()
TEMPLATES_DIR = RESOURCE_DIR / "app" / "templates"
STATIC_DIR = RESOURCE_DIR / "static"

# 服务器配置
HOST = "127.0.0.1"
PORT = 18664


def migrate_ai_config_to_db():
    """将旧 JSON 配置迁移到数据库 AiProvider 表（仅首次运行时执行）"""
    from app.models import AiProvider, LocalSession
    session = LocalSession()
    try:
        # 如果已有 provider 则跳过
        if session.query(AiProvider).count() > 0:
            return
        # 尝试从旧 JSON 配置读取
        config_file = DATA_DIR / "ai_config.json"
        if not config_file.exists():
            return
        with open(config_file, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if saved.get("api_key"):
            provider = AiProvider(
                name="DeepSeek",
                base_url=saved.get("base_url", "https://api.deepseek.com"),
                api_key=saved["api_key"],
                model=saved.get("model", "deepseek-chat"),
                temperature=saved.get("temperature", 0.0),
                is_active=True,
            )
            session.add(provider)
            session.commit()
    except Exception as e:
        session.rollback()
        print(f"[迁移] AI 配置迁移失败: {e}")
    finally:
        session.close()
