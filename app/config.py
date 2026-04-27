"""配置管理模块"""

import os
import json
from pathlib import Path


# 项目根目录
BASE_DIR = Path(__file__).resolve().parent.parent

# 本地存储目录（用户数据）
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 本地 SQLite 数据库路径（存储连接配置、SQL历史等）
LOCAL_DB_PATH = DATA_DIR / "dbagent.db"

# 模板和静态文件目录
TEMPLATES_DIR = BASE_DIR / "app" / "templates"
STATIC_DIR = BASE_DIR / "static"

# 服务器配置
HOST = "127.0.0.1"
PORT = 18664

# AI 配置（默认值，用户可在设置中修改）
DEFAULT_AI_CONFIG = {
    "api_key": "",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "temperature": 0.7,
}


def load_ai_config() -> dict:
    """加载 AI 配置"""
    config_file = DATA_DIR / "ai_config.json"
    if config_file.exists():
        with open(config_file, "r", encoding="utf-8") as f:
            saved = json.load(f)
        # 合并默认值，确保新增字段有默认值
        config = {**DEFAULT_AI_CONFIG, **saved}
    else:
        config = dict(DEFAULT_AI_CONFIG)
    return config


def save_ai_config(config: dict):
    """保存 AI 配置"""
    config_file = DATA_DIR / "ai_config.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
