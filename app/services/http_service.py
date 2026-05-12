"""HTTP 请求代理服务

使用 httpx 代理发送 HTTP 请求，自动注入全局变量到请求头。
"""

import json
import time
from typing import Optional

import httpx

from app.models import ApiEnvironment, ApiHistory, GlobalVariable, LocalSession


def _get_active_env_vars() -> dict:
    """获取全局变量"""
    session = LocalSession()
    try:
        rows = session.query(GlobalVariable).all()
        return {row.var_key: row.var_value for row in rows}
    finally:
        session.close()


def _get_active_env_base_url() -> str:
    """获取当前激活环境的 base_url"""
    session = LocalSession()
    try:
        env = session.query(ApiEnvironment).filter(
            ApiEnvironment.is_active == True
        ).first()
        if env:
            return env.base_url or ""
        return ""
    finally:
        session.close()


# 环境变量 key -> HTTP Header 映射
_ENV_HEADER_MAP = {
    "authorization": "Authorization",
    "token": "Authorization",
    "cookie": "Cookie",
    "content_type": "Content-Type",
}


def _inject_env_headers(headers: dict, variables: dict):
    """将环境变量中的常用认证/头信息自动注入到请求头（用户未手动设置时）"""
    if not variables:
        return
    for var_key, header_key in _ENV_HEADER_MAP.items():
        var_val = variables.get(var_key)
        if var_val is None:
            continue
        header_lower = header_key.lower()
        if not any(k.lower() == header_lower for k in headers):
            # token 类型自动加 Bearer 前缀（如果值本身不是 Bearer 开头）
            if var_key == "token" and not str(var_val).startswith("Bearer "):
                headers[header_key] = f"Bearer {var_val}"
            else:
                headers[header_key] = str(var_val)


async def send_request(
    method: str,
    url: str,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    body_type: str = "none",
    body_raw: str = "",
    body_form: Optional[list] = None,
    timeout: int = 300,
) -> dict:
    """发送 HTTP 请求并返回响应"""
    original_url = url  # 保存原始路径用于历史记录
    headers = headers or {}

    # 自动注入环境变量中常见的 Header 变量
    variables = _get_active_env_vars()
    _inject_env_headers(headers, variables)

    # 自动拼接 base_url
    base_url = _get_active_env_base_url()
    if base_url and not url.startswith(('http://', 'https://')):
        url = base_url.rstrip('/') + '/' + url.lstrip('/')

    # 构建 body
    content = None
    data = None
    json_body = None
    files = None

    if body_type == "json":
        # 确保设置 Content-Type
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        try:
            json_body = json.loads(body_raw) if body_raw else None
        except json.JSONDecodeError:
            json_body = None
            content = body_raw.encode("utf-8")
    elif body_type == "form":
        form_data = body_form or []
        fields = []
        file_fields = []
        for item in form_data:
            key = str(item.get("key", ""))
            val = str(item.get("value", ""))
            if item.get("type") == "file":
                file_fields.append((key, (val, b"", "application/octet-stream")))
            else:
                fields.append((key, val))
        if file_fields:
            files = file_fields
            data = dict(fields) if fields else None
        else:
            data = dict(fields) if fields else None
    elif body_type == "raw":
        content = body_raw.encode("utf-8") if body_raw else None
    elif body_type == "xml":
        content = body_raw.encode("utf-8") if body_raw else None
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/xml"

    start_time = time.time()
    status_code = 0
    resp_body = ""
    resp_headers = {}
    error = None

    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                content=content,
                data=data,
                json=json_body,
                files=files,
                follow_redirects=True,
            )
            status_code = resp.status_code
            resp_headers = dict(resp.headers)
            try:
                resp_body = resp.text
            except Exception:
                resp_body = resp.content.hex()
    except httpx.TimeoutException:
        error = f"请求超时 ({timeout}s)"
    except httpx.ConnectError as e:
        error = f"连接失败: {str(e)}"
    except Exception as e:
        error = f"请求错误: {str(e)}"

    elapsed_ms = int((time.time() - start_time) * 1000)
    size_bytes = len(resp_body.encode("utf-8")) if resp_body else 0

    # 尝试解析 JSON 以格式化
    body_preview = resp_body
    try:
        parsed = json.loads(resp_body)
        body_preview = json.dumps(parsed, ensure_ascii=False, indent=2)
    except (json.JSONDecodeError, ValueError):
        pass

    result = {
        "success": error is None,
        "status_code": status_code,
        "headers": resp_headers,
        "body": body_preview,
        "elapsed_ms": elapsed_ms,
        "size_bytes": size_bytes,
        "error": error,
    }

    # 保存到历史
    _save_history(
        method=method, url=original_url,
        req_headers=headers, req_params=params,
        req_body=body_raw, body_type=body_type,
        status_code=status_code, resp_body=body_preview,
        elapsed_ms=elapsed_ms,
    )

    return result


def _save_history(method, url, req_headers, req_params, req_body, body_type, status_code, resp_body, elapsed_ms):
    """记录请求历史"""
    session = LocalSession()
    try:
        h = ApiHistory(
            method=method,
            url=url,
            request_headers=json.dumps(req_headers, ensure_ascii=False) if isinstance(req_headers, dict) else str(req_headers),
            request_params=json.dumps(req_params, ensure_ascii=False) if isinstance(req_params, dict) else str(req_params),
            request_body=req_body[:5000] if req_body else "",
            body_type=body_type or "none",
            status_code=status_code,
            response_body=resp_body[:20000] if resp_body else "",
            elapsed_ms=elapsed_ms,
        )
        session.add(h)
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()


def generate_curl(method: str, url: str, headers: dict, params: dict,
                  body_type: str, body_raw: str) -> str:
    """生成 cURL 命令"""
    headers = headers or {}
    variables = _get_active_env_vars()
    _inject_env_headers(headers, variables)

    # 自动拼接 base_url
    base_url = _get_active_env_base_url()
    if base_url and not url.startswith(('http://', 'https://')):
        url = base_url.rstrip('/') + '/' + url.lstrip('/')

    # 构建带参数的 URL
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url += ("?" if "?" not in url else "&") + qs

    parts = [f"curl -X {method.upper()}"]
    parts.append(f"  '{url}'")

    for k, v in headers.items():
        parts.append(f"  -H '{k}: {v}'")

    if body_type in ("json", "raw", "xml") and body_raw:
        parts.append(f"  -d '{body_raw}'")

    return " \\\n".join(parts)
