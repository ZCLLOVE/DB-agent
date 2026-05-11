"""AES-256-GCM 加解密工具

密钥文件存储在 data/.secret_key，首次使用自动生成。
"""

import base64
import os
from pathlib import Path

from app.config import DATA_DIR

_KEY_FILE = DATA_DIR / ".secret_key"
_KEY_SIZE = 32  # AES-256


def _get_key() -> bytes:
    """获取或生成 32 字节密钥"""
    if _KEY_FILE.exists():
        return base64.b64decode(_KEY_FILE.read_text(encoding="utf-8").strip())
    key = os.urandom(_KEY_SIZE)
    _KEY_FILE.write_text(base64.b64encode(key).decode("utf-8"), encoding="utf-8")
    return key


def encrypt(plaintext: str) -> tuple[str, str]:
    """AES-256-GCM 加密，返回 (ciphertext_b64, nonce_b64)"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _get_key()
    nonce = os.urandom(12)  # GCM 推荐 96-bit nonce
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(ct).decode("utf-8"), base64.b64encode(nonce).decode("utf-8")


def decrypt(ciphertext_b64: str, nonce_b64: str) -> str:
    """AES-256-GCM 解密，返回明文字符串"""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _get_key()
    ct = base64.b64decode(ciphertext_b64)
    nonce = base64.b64decode(nonce_b64)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
