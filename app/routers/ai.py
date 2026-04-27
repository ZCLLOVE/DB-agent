"""AI 对话接口

提供流式 AI 对话能力，支持多轮上下文。
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import ConnectionConfig, get_local_session
from app.services.ai_service import ai_service
from app.config import load_ai_config, save_ai_config

router = APIRouter(prefix="/api/ai", tags=["AI对话"])


class ChatRequest(BaseModel):
    message: str
    connection_id: int
    chat_history: list[dict] = []


class AiConfigRequest(BaseModel):
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    temperature: float = 0.0


@router.post("/chat")
async def chat(req: ChatRequest,
               session: Session = Depends(get_local_session)):
    """流式 AI 对话"""
    # 验证连接存在
    conn = session.query(ConnectionConfig).get(req.connection_id)
    if not conn:
        raise HTTPException(404, "连接不存在")

    # 在消息中注入 connection_id 上下文
    context_message = (
        f"[当前连接: {conn.name} ({conn.db_type}), "
        f"数据库: {conn.database}, connection_id={req.connection_id}]\n\n"
        f"{req.message}"
    )

    return StreamingResponse(
        ai_service.chat_stream(context_message, req.chat_history, req.connection_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/config")
def get_ai_config():
    """获取 AI 配置"""
    config = load_ai_config()
    # 脱敏 API Key
    masked = config.copy()
    if masked["api_key"]:
        key = masked["api_key"]
        masked["api_key_display"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
    else:
        masked["api_key_display"] = ""
    return masked


@router.post("/config")
def update_ai_config(req: AiConfigRequest):
    """更新 AI 配置"""
    config = load_ai_config()
    # 只更新非空字段
    if req.api_key:
        config["api_key"] = req.api_key
    config["base_url"] = req.base_url
    config["model"] = req.model
    config["temperature"] = req.temperature

    save_ai_config(config)
    ai_service.reset()  # 重置 Agent 以使用新配置
    return {"message": "配置已保存"}
