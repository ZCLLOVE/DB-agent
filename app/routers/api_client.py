"""API 客户端路由

HTTP 请求发送、集合管理、请求 CRUD、历史、环境变量、cURL。
"""

import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional

from app.models import (
    get_local_session, ApiCollection, ApiRequest,
    ApiEnvironment, ApiHistory,
)
from app.services.http_service import send_request, generate_curl

router = APIRouter(prefix="/api/http", tags=["http_client"])


# ==================== 请求发送 ====================

@router.post("/send")
async def http_send(body: dict):
    """发送 HTTP 请求"""
    result = await send_request(
        method=body.get("method", "GET"),
        url=body.get("url", ""),
        headers=body.get("headers", {}),
        params=body.get("params", {}),
        body_type=body.get("body_type", "none"),
        body_raw=body.get("body_raw", ""),
        body_form=body.get("body_form", []),
        timeout=body.get("timeout", 30),
    )
    return result


# ==================== 集合管理 ====================

@router.get("/collections")
def list_collections(session: Session = Depends(get_local_session)):
    """获取集合树"""
    colls = session.query(ApiCollection).order_by(
        ApiCollection.sort_order, ApiCollection.id
    ).all()
    return [c.to_dict() for c in colls]


@router.post("/collections")
def create_collection(body: dict, session: Session = Depends(get_local_session)):
    """创建集合/文件夹"""
    coll = ApiCollection(
        name=body.get("name", "新集合"),
        parent_id=body.get("parent_id"),
        sort_order=body.get("sort_order", 0),
    )
    session.add(coll)
    session.commit()
    session.refresh(coll)
    return coll.to_dict()


@router.put("/collections/{coll_id}")
def update_collection(coll_id: int, body: dict, session: Session = Depends(get_local_session)):
    """重命名集合"""
    coll = session.query(ApiCollection).get(coll_id)
    if not coll:
        return {"error": "集合不存在"}
    if "name" in body:
        coll.name = body["name"]
    if "parent_id" in body:
        coll.parent_id = body["parent_id"]
    if "sort_order" in body:
        coll.sort_order = body["sort_order"]
    session.commit()
    return coll.to_dict()


@router.delete("/collections/{coll_id}")
def delete_collection(coll_id: int, session: Session = Depends(get_local_session)):
    """删除集合及其下所有请求和子集合"""

    def _delete_recursive(pid):
        children = session.query(ApiCollection).filter(ApiCollection.parent_id == pid).all()
        for child in children:
            _delete_recursive(child.id)
        session.query(ApiRequest).filter(ApiRequest.collection_id == pid).delete()
        session.query(ApiCollection).filter(ApiCollection.id == pid).delete()

    _delete_recursive(coll_id)
    session.commit()
    return {"ok": True}


# ==================== 请求 CRUD ====================

@router.get("/collections/{coll_id}/requests")
def list_requests(coll_id: int, session: Session = Depends(get_local_session)):
    """获取集合下的请求列表"""
    reqs = session.query(ApiRequest).filter(
        ApiRequest.collection_id == coll_id
    ).order_by(ApiRequest.id).all()
    return [r.to_dict() for r in reqs]


@router.get("/requests/{req_id}")
def get_request(req_id: int, session: Session = Depends(get_local_session)):
    """获取请求详情"""
    req = session.query(ApiRequest).get(req_id)
    if not req:
        return {"error": "请求不存在"}
    return req.to_dict()


@router.post("/requests")
def create_request(body: dict, session: Session = Depends(get_local_session)):
    """保存请求"""
    import json
    req = ApiRequest(
        collection_id=body.get("collection_id"),
        name=body.get("name", "未命名请求"),
        method=body.get("method", "GET"),
        url=body.get("url", ""),
        headers=json.dumps(body.get("headers", {}), ensure_ascii=False),
        params=json.dumps(body.get("params", {}), ensure_ascii=False),
        body_type=body.get("body_type", "none"),
        body_raw=body.get("body_raw", ""),
        body_form=json.dumps(body.get("body_form", []), ensure_ascii=False),
    )
    session.add(req)
    session.commit()
    session.refresh(req)
    return req.to_dict()


@router.put("/requests/{req_id}")
def update_request(req_id: int, body: dict, session: Session = Depends(get_local_session)):
    """更新请求"""
    import json
    req = session.query(ApiRequest).get(req_id)
    if not req:
        return {"error": "请求不存在"}
    for field in ("name", "method", "url", "body_type", "body_raw"):
        if field in body:
            setattr(req, field, body[field])
    if "headers" in body:
        req.headers = json.dumps(body["headers"], ensure_ascii=False)
    if "params" in body:
        req.params = json.dumps(body["params"], ensure_ascii=False)
    if "body_form" in body:
        req.body_form = json.dumps(body["body_form"], ensure_ascii=False)
    if "collection_id" in body:
        req.collection_id = body["collection_id"]
    session.commit()
    return req.to_dict()


@router.delete("/requests/{req_id}")
def delete_request(req_id: int, session: Session = Depends(get_local_session)):
    """删除请求"""
    session.query(ApiRequest).filter(ApiRequest.id == req_id).delete()
    session.commit()
    return {"ok": True}


@router.post("/requests/{req_id}/duplicate")
def duplicate_request(req_id: int, session: Session = Depends(get_local_session)):
    """复制请求"""
    req = session.query(ApiRequest).get(req_id)
    if not req:
        return {"error": "请求不存在"}
    import json
    new_req = ApiRequest(
        collection_id=req.collection_id,
        name=req.name + " (副本)",
        method=req.method,
        url=req.url,
        headers=req.headers,
        params=req.params,
        body_type=req.body_type,
        body_raw=req.body_raw,
        body_form=req.body_form,
    )
    session.add(new_req)
    session.commit()
    session.refresh(new_req)
    return new_req.to_dict()


# ==================== 所有请求（扁平列表） ====================

@router.get("/requests")
def list_all_requests(session: Session = Depends(get_local_session)):
    """获取所有保存的请求（扁平列表，供侧边栏用）"""
    reqs = session.query(ApiRequest).order_by(ApiRequest.id).all()
    return [r.to_dict() for r in reqs]


# ==================== 历史记录 ====================

@router.get("/history")
def list_history(session: Session = Depends(get_local_session)):
    """获取调用历史"""
    records = session.query(ApiHistory).order_by(
        ApiHistory.id.desc()
    ).limit(100).all()
    return [{
        "id": h.id,
        "method": h.method,
        "url": h.url,
        "request_headers": json.loads(h.request_headers or "{}"),
        "request_params": json.loads(h.request_params or "{}"),
        "request_body": h.request_body or "",
        "body_type": h.body_type or "none",
        "status_code": h.status_code,
        "elapsed_ms": h.elapsed_ms,
        "created_at": h.created_at.isoformat() if h.created_at else None,
    } for h in records]


@router.delete("/history")
def clear_history(session: Session = Depends(get_local_session)):
    """清空历史"""
    session.query(ApiHistory).delete()
    session.commit()
    return {"ok": True}


# ==================== 环境变量 ====================

@router.get("/environments")
def list_environments(session: Session = Depends(get_local_session)):
    """获取所有环境"""
    envs = session.query(ApiEnvironment).all()
    return [e.to_dict() for e in envs]


@router.post("/environments")
def create_environment(body: dict, session: Session = Depends(get_local_session)):
    """创建环境"""
    import json
    env = ApiEnvironment(
        name=body.get("name", "新环境"),
        base_url=body.get("base_url", ""),
        variables=json.dumps(body.get("variables", {}), ensure_ascii=False),
    )
    session.add(env)
    session.commit()
    session.refresh(env)
    return env.to_dict()


@router.put("/environments/{env_id}")
def update_environment(env_id: int, body: dict, session: Session = Depends(get_local_session)):
    """更新环境"""
    import json
    env = session.query(ApiEnvironment).get(env_id)
    if not env:
        return {"error": "环境不存在"}
    if "name" in body:
        env.name = body["name"]
    if "base_url" in body:
        env.base_url = body["base_url"]
    if "variables" in body:
        env.variables = json.dumps(body["variables"], ensure_ascii=False)
    session.commit()
    return env.to_dict()


@router.delete("/environments/{env_id}")
def delete_environment(env_id: int, session: Session = Depends(get_local_session)):
    """删除环境"""
    session.query(ApiEnvironment).filter(ApiEnvironment.id == env_id).delete()
    session.commit()
    return {"ok": True}


@router.post("/environments/{env_id}/activate")
def activate_environment(env_id: int, session: Session = Depends(get_local_session)):
    """激活环境"""
    # 先取消所有激活
    session.query(ApiEnvironment).update({"is_active": False})
    env = session.query(ApiEnvironment).get(env_id)
    if env:
        env.is_active = True
    session.commit()
    return {"ok": True}


# ==================== cURL ====================

@router.post("/curl")
def parse_curl(body: dict):
    """从 cURL 字符串解析为请求对象"""
    import re
    curl_str = body.get("curl", "")
    if not curl_str:
        return {"error": "cURL 命令不能为空"}

    # 基础解析
    method = "GET"
    url = ""
    headers = {}
    body_raw = ""

    # 提取 method
    m = re.search(r'-X\s+(\w+)', curl_str)
    if m:
        method = m.group(1).upper()

    # 提取 URL
    m = re.search(r"curl\s+(?:-[^\s]+\s+)*['\"]?(https?://[^\s'\"]+)['\"]?", curl_str)
    if m:
        url = m.group(1)
    else:
        m = re.search(r"'(https?://[^']+)'", curl_str)
        if m:
            url = m.group(1)

    # 提取 headers
    for m in re.finditer(r"-H\s+['\"](.+?):\s*(.+?)['\"]", curl_str):
        headers[m.group(1)] = m.group(2)

    # 提取 body
    m = re.search(r"-d\s+['\"](.+?)['\"]", curl_str, re.DOTALL)
    if m:
        body_raw = m.group(1)
        if method == "GET":
            method = "POST"

    return {
        "method": method,
        "url": url,
        "headers": headers,
        "body_type": "json" if body_raw else "none",
        "body_raw": body_raw,
    }


@router.post("/generate-curl")
def gen_curl(body: dict):
    """生成 cURL 命令"""
    curl = generate_curl(
        method=body.get("method", "GET"),
        url=body.get("url", ""),
        headers=body.get("headers", {}),
        params=body.get("params", {}),
        body_type=body.get("body_type", "none"),
        body_raw=body.get("body_raw", ""),
    )
    return {"curl": curl}
