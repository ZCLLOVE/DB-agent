"""AI 对话接口

提供流式 AI 对话能力，支持多轮上下文和多提供商管理。
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import ConnectionConfig, AiProvider, ChatSession, get_local_session
from app.services.ai_service import ai_service

router = APIRouter(prefix="/api/ai", tags=["AI对话"])


class ChatRequest(BaseModel):
    message: str
    connection_id: int | None = None
    chat_history: list[dict] = []


class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    model: str
    temperature: float = 0.0


class ProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    temperature: float | None = None


# ── AI 对话 ──

@router.post("/chat")
async def chat(req: ChatRequest,
               session: Session = Depends(get_local_session)):
    """流式 AI 对话"""
    if req.connection_id:
        conn = session.query(ConnectionConfig).get(req.connection_id)
        if not conn:
            raise HTTPException(404, "连接不存在")
        context_message = (
            f"[当前连接: {conn.name} ({conn.db_type}), "
            f"数据库: {conn.database}, connection_id={req.connection_id}]\n\n"
            f"{req.message}"
        )
        mode = "db"
        conn_id = req.connection_id
    else:
        context_message = f"[API 测试助手模式]\n\n{req.message}"
        mode = "api"
        conn_id = 0

    return StreamingResponse(
        ai_service.chat_stream(context_message, req.chat_history, conn_id, mode=mode),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── 提供商管理 ──

@router.get("/providers")
def list_providers(session: Session = Depends(get_local_session)):
    """列出所有 AI 提供商"""
    providers = session.query(AiProvider).order_by(AiProvider.id).all()
    return [p.to_dict(mask_key=True) for p in providers]


@router.post("/providers")
def create_provider(req: ProviderCreate,
                    session: Session = Depends(get_local_session)):
    """新建 AI 提供商"""
    provider = AiProvider(
        name=req.name,
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
        temperature=req.temperature,
        is_active=False,
    )
    # 如果是第一个提供商，自动激活
    if session.query(AiProvider).count() == 0:
        provider.is_active = True
    session.add(provider)
    session.commit()
    session.refresh(provider)
    ai_service.reset()
    return provider.to_dict(mask_key=True)


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, req: ProviderUpdate,
                    session: Session = Depends(get_local_session)):
    """更新 AI 提供商"""
    provider = session.query(AiProvider).get(provider_id)
    if not provider:
        raise HTTPException(404, "提供商不存在")
    if req.name is not None:
        provider.name = req.name
    if req.base_url is not None:
        provider.base_url = req.base_url
    if req.api_key is not None:
        provider.api_key = req.api_key
    if req.model is not None:
        provider.model = req.model
    if req.temperature is not None:
        provider.temperature = req.temperature
    session.commit()
    session.refresh(provider)
    ai_service.reset()
    return provider.to_dict(mask_key=True)


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int,
                    session: Session = Depends(get_local_session)):
    """删除 AI 提供商"""
    provider = session.query(AiProvider).get(provider_id)
    if not provider:
        raise HTTPException(404, "提供商不存在")
    was_active = provider.is_active
    session.delete(provider)
    # 如果删除的是激活的提供商，激活第一个剩余的
    if was_active:
        first = session.query(AiProvider).order_by(AiProvider.id).first()
        if first:
            first.is_active = True
    session.commit()
    ai_service.reset()
    return {"message": "已删除"}


@router.post("/providers/{provider_id}/activate")
def activate_provider(provider_id: int,
                      session: Session = Depends(get_local_session)):
    """激活指定提供商"""
    provider = session.query(AiProvider).get(provider_id)
    if not provider:
        raise HTTPException(404, "提供商不存在")
    # 取消其他激活
    session.query(AiProvider).update({"is_active": False})
    provider.is_active = True
    session.commit()
    ai_service.reset()
    return provider.to_dict(mask_key=True)


@router.get("/active-provider")
def get_active_provider(session: Session = Depends(get_local_session)):
    """获取当前激活的提供商"""
    provider = session.query(AiProvider).filter(AiProvider.is_active == True).first()
    if provider:
        return provider.to_dict(mask_key=True)
    return None


# ── 会话管理 ──

@router.get("/sessions")
def list_sessions(session: Session = Depends(get_local_session)):
    """列出所有会话（不含消息内容）"""
    sessions = session.query(ChatSession).order_by(
        ChatSession.updated_at.desc()
    ).limit(100).all()
    return [s.to_dict() for s in sessions]


@router.post("/sessions")
def create_session(session: Session = Depends(get_local_session)):
    """新建空会话"""
    s = ChatSession(title="新会话")
    session.add(s)
    session.commit()
    session.refresh(s)
    return {**s.to_dict(), "messages": []}


@router.get("/sessions/{session_id}")
def get_session(session_id: int, session: Session = Depends(get_local_session)):
    """获取会话详情（含消息）"""
    s = session.query(ChatSession).get(session_id)
    if not s:
        raise HTTPException(404, "会话不存在")
    return {**s.to_dict(), "messages": s.get_messages()}


class SessionUpdate(BaseModel):
    title: str | None = None
    messages: list[dict] | None = None


@router.put("/sessions/{session_id}/save")
def save_session(session_id: int, req: SessionUpdate,
                 session: Session = Depends(get_local_session)):
    """保存会话（标题和消息）"""
    s = session.query(ChatSession).get(session_id)
    if not s:
        raise HTTPException(404, "会话不存在")
    if req.title is not None:
        s.title = req.title[:200]
    if req.messages is not None:
        s.set_messages(req.messages)
    session.commit()
    return s.to_dict()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, session: Session = Depends(get_local_session)):
    """删除会话"""
    s = session.query(ChatSession).get(session_id)
    if not s:
        raise HTTPException(404, "会话不存在")
    session.delete(s)
    session.commit()
    return {"message": "已删除"}
