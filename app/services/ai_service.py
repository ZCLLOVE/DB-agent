"""AI 对话服务

直接使用 OpenAI 客户端实现 Agent 工具调用，不依赖 LangChain Agent。
完整控制消息格式，正确处理 DeepSeek 的 reasoning_content。
"""

from typing import AsyncGenerator
import json
from openai import AsyncOpenAI

from app.models import AiProvider, LocalSession
from app.agents.tools import TOOL_DEFINITIONS, TOOL_FUNCTIONS, HTTP_TOOL_DEFINITIONS, HTTP_TOOL_FUNCTIONS


SYSTEM_PROMPT_DB = """你是一个专业的数据库助手和 API 测试助手。你可以帮助用户查询数据库、操作数据，以及调用和测试 HTTP 接口。

你有以下数据库工具：
- list_databases: 列出所有数据库
- list_tables: 列出指定数据库的所有表
- describe_table: 查看表结构（字段名、类型、注释）
- get_table_sample: 获取表的样例数据
- execute_sql: 执行 SQL 语句

你有以下 HTTP 工具：
- http_request: 发送 HTTP 请求（支持 GET/POST/PUT/DELETE 等）
- save_api_request: 将请求保存到集合中（新增）
- list_api_collections: 列出所有接口集合及其中的请求（查询）
- get_api_request: 查询已保存的接口请求详情（查询）
- update_api_request: 更新已保存的请求（修改）
- delete_api_request: 删除已保存的请求（删除）
- delete_api_collection: 删除集合及其下所有请求（删除）
- list_api_environments: 列出所有环境变量配置
- create_api_environment: 创建环境变量
- update_api_environment: 更新环境变量
- delete_api_environment: 删除环境变量

数据库使用规则：
1. 先了解用户的数据库结构再写 SQL（用 list_tables 和 describe_table）
2. 写 SQL 前最好先看看样例数据（用 get_table_sample）
3. SELECT 语句可以直接执行
4. INSERT/UPDATE/DELETE/DDL 等写操作
5. 回复使用中文，简洁明了
6. 如果生成的 SQL 较复杂，简单解释一下

API 测试规则：
1. 当用户说"调用xxx接口"时，使用 http_request 工具发送请求
2. 如果缺少 URL、方法等必要参数，主动询问用户
3. 当用户说"测试登录接口"等场景时，自动生成合理的 Mock 数据
4. 收到响应后，分析状态码、数据结构，指出潜在问题
5. 用户可以让保存常用接口，使用 save_api_request 工具
6. 用户要求删除/修改接口时，使用 delete_api_request / update_api_request
"""

SYSTEM_PROMPT_API = """你是一个专业的 API 测试助手。你可以帮助用户调用 HTTP 接口、分析响应、Mock 数据，以及管理接口集合和环境变量。

你有以下工具：

接口请求：
- http_request: 发送 HTTP 请求（支持 GET/POST/PUT/DELETE 等）

接口集合管理（增删改查）：
- save_api_request: 将请求保存到集合中（新增）
- list_api_collections: 列出所有接口集合及其中的请求（查询）
- get_api_request: 根据名称或集合查询已保存的接口请求详情（查询）
- update_api_request: 更新已保存的接口请求（修改）
- delete_api_request: 删除已保存的接口请求（删除）
- delete_api_collection: 删除集合及其下所有请求（删除）

环境变量管理（增删改查）：
- list_api_environments: 列出所有环境变量配置（查询）
- create_api_environment: 创建环境变量（新增）
- update_api_environment: 更新环境变量（修改），支持 merge_variables 合并模式
- delete_api_environment: 删除环境变量（删除）

使用规则：
1. 当用户说"调用xxx接口"时，使用 http_request 工具发送请求
2. 如果缺少 URL、方法等必要参数，主动询问用户
3. 当用户说"测试登录接口"等场景时，自动生成合理的 Mock 测试数据
4. 收到响应后，分析状态码、数据结构、字段含义，指出潜在问题
5. 用户可以让你保存常用接口，使用 save_api_request 工具
6. 用户问"有哪些接口"或"查一下xxx接口"时，使用 list_api_collections 或 get_api_request 查询
7. 用户要求删除/修改接口时，使用 delete_api_request / update_api_request
8. 用户要求管理环境变量时，使用对应的环境变量 CRUD 工具
9. 支持 URL/Headers/Body 中的环境变量占位符 {{variable_name}}
10. 回复使用中文，简洁明了
11. 可以帮用户生成各种请求的入参 Mock 数据（姓名、手机号、邮箱、地址等）
"""


def _get_active_provider_config() -> dict:
    """从数据库获取当前激活的 AI 提供商配置"""
    session = LocalSession()
    try:
        provider = session.query(AiProvider).filter(AiProvider.is_active == True).first()
        if provider:
            return {
                "api_key": provider.api_key,
                "base_url": provider.base_url,
                "model": provider.model,
                "temperature": provider.temperature,
            }
        return {}
    finally:
        session.close()


class AiService:
    """AI 对话服务，基于 OpenAI 客户端实现 Agent 循环"""

    def __init__(self):
        self._client: AsyncOpenAI | None = None
        self._config_cache: dict | None = None

    def _get_client(self) -> AsyncOpenAI:
        """获取或创建 OpenAI 客户端"""
        config = _get_active_provider_config()
        if self._config_cache == config and self._client:
            return self._client

        if not config.get("api_key"):
            raise ValueError("请先在设置中配置 AI API Key")

        self._client = AsyncOpenAI(
            api_key=config["api_key"],
            base_url=config["base_url"],
        )
        self._config_cache = config
        return self._client

    def _get_model(self) -> str:
        config = _get_active_provider_config()
        return config.get("model", "deepseek-chat")

    async def chat_stream(self, message: str, chat_history: list[dict],
                          connection_id: int, mode: str = "db") -> AsyncGenerator[str, None]:
        """流式 Agent 对话，手动实现工具调用循环

        mode: "db" 使用数据库+HTTP工具, "api" 仅使用HTTP工具
        """
        client = self._get_client()
        model = self._get_model()

        # 根据 mode 选择工具集和系统提示
        if mode == "api":
            system_prompt = SYSTEM_PROMPT_API
            all_tools = HTTP_TOOL_DEFINITIONS
            all_functions = HTTP_TOOL_FUNCTIONS
        else:
            system_prompt = SYSTEM_PROMPT_DB
            all_tools = TOOL_DEFINITIONS + HTTP_TOOL_DEFINITIONS
            all_functions = {**TOOL_FUNCTIONS, **HTTP_TOOL_FUNCTIONS}

        # 构建消息列表
        messages = [{"role": "system", "content": system_prompt}]

        # 添加历史消息
        for msg in chat_history:
            messages.append({
                "role": msg["role"],
                "content": msg["content"],
            })

        # 添加当前用户消息
        messages.append({"role": "user", "content": message})

        # Agent 循环：最多 10 轮工具调用
        for _ in range(10):
            # 调用 API（流式）
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=all_tools,
                stream=True,
                max_tokens=8192,
            )

            # 收集流式响应
            content_parts = []
            tool_calls_map = {}  # index -> {id, name, arguments}
            reasoning_content_parts = []

            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                # 处理普通文本内容
                if delta.content:
                    content_parts.append(delta.content)
                    yield f"data: {json.dumps({'type': 'token', 'content': delta.content})}\n\n"

                # 处理推理内容（DeepSeek reasoning），静默收集不输出
                if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                    reasoning_content_parts.append(delta.reasoning_content)

                # 处理工具调用
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_map:
                            tool_calls_map[idx] = {
                                "id": tc.id or "",
                                "name": "",
                                "arguments": "",
                            }
                        if tc.id:
                            tool_calls_map[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_map[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_map[idx]["arguments"] += tc.function.arguments

            # 如果没有工具调用，Agent 循环结束
            if not tool_calls_map:
                break

            # 构建完整的 assistant 消息（包含 reasoning_content）
            assistant_msg = {"role": "assistant"}
            full_content = "".join(content_parts)
            if full_content:
                assistant_msg["content"] = full_content
            else:
                assistant_msg["content"] = None

            # DeepSeek: 把 reasoning_content 加回消息
            if reasoning_content_parts:
                assistant_msg["reasoning_content"] = "".join(reasoning_content_parts)

            # 添加工具调用
            assistant_msg["tool_calls"] = []
            for idx in sorted(tool_calls_map.keys()):
                tc = tool_calls_map[idx]
                assistant_msg["tool_calls"].append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                    },
                })

            messages.append(assistant_msg)

            # 执行每个工具调用
            for idx in sorted(tool_calls_map.keys()):
                tc = tool_calls_map[idx]
                tool_name = tc["name"]
                tool_args = json.loads(tc["arguments"])
                tool_call_id = tc["id"]

                yield f"data: {json.dumps({'type': 'tool_start', 'tool': tool_name, 'input': str(tool_args)})}\n\n"

                # 执行工具
                try:
                    tool_fn = all_functions.get(tool_name)
                    if tool_fn:
                        result = tool_fn(**tool_args)
                    else:
                        result = f"未知工具: {tool_name}"
                except Exception as e:
                    result = f"工具执行错误: {str(e)}"

                yield f"data: {json.dumps({'type': 'tool_end', 'tool': tool_name, 'output': str(result)[:500]})}\n\n"

                # 将工具结果加入消息列表
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": str(result),
                })

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    def reset(self):
        """重置客户端"""
        self._client = None
        self._config_cache = None


# 全局单例
ai_service = AiService()
