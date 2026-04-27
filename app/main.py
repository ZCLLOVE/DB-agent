"""DB-Agent FastAPI 入口

启动 FastAPI 服务器，注册路由，初始化本地数据库。
"""

import sys
import webbrowser
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi import Request

from app.config import TEMPLATES_DIR, STATIC_DIR, HOST, PORT
from app.models import init_local_db

# 创建 FastAPI 应用
app = FastAPI(title="DB-Agent", version="1.0.0")

# 挂载静态文件
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 模板
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


# 注册路由
from app.routers import connection, table, sql, ai
app.include_router(connection.router)
app.include_router(table.router)
app.include_router(sql.router)
app.include_router(ai.router)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """主页"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.on_event("startup")
async def startup():
    """应用启动时初始化"""
    init_local_db()


def open_browser():
    """延迟打开浏览器"""
    import time
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}")


def main():
    """入口函数"""
    # 启动时自动打开浏览器
    threading.Thread(target=open_browser, daemon=True).start()

    print(f"DB-Agent 启动中... http://{HOST}:{PORT}")
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
