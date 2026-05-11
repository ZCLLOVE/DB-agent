"""Secret 记事本路由"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.models import get_local_session, SecretNote
from app.utils.crypto import encrypt, decrypt

router = APIRouter(prefix="/api/secret", tags=["secret"])


class SecretContent(BaseModel):
    content: str


@router.get("")
async def get_secret(session: Session = Depends(get_local_session)):
    """获取记事本内容（解密后返回）"""
    note = session.query(SecretNote).filter(SecretNote.title == "default").first()
    if not note or not note.content:
        return {"content": ""}
    try:
        return {"content": decrypt(note.content, note.nonce)}
    except Exception:
        return {"content": ""}


@router.put("")
async def save_secret(body: SecretContent, session: Session = Depends(get_local_session)):
    """保存记事本内容（加密后存库）"""
    ct, nonce = encrypt(body.content)
    note = session.query(SecretNote).filter(SecretNote.title == "default").first()
    if note:
        note.content = ct
        note.nonce = nonce
    else:
        note = SecretNote(title="default", content=ct, nonce=nonce)
        session.add(note)
    session.commit()
    return {"ok": True}
