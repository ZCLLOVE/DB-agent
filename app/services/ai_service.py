"""AI 对话服务

直接使用 OpenAI 客户端实现 Agent 工具调用，不依赖 LangChain Agent。
完整控制消息格式，正确处理 DeepSeek 的 reasoning_content。
"""

from typing import AsyncGenerator
import json
import inspect
from openai import AsyncOpenAI

from app.config import load_ai_config
from app.agents.tools import TOOL_DEFINITIONS, TOOL_FUNCTIONS


SYSTEM_PROMPT = """你是一个专业的数据库助手。你可以帮助用户查询和操作数据库。

你有以下工具可以使用：
- list_databases: 列出所有数据库
- list_tables: 列出指定数据库的所有表
- describe_table: 查看表结构（字段名、类型、注释）
- get_table_sample: 获取表的样例数据
- execute_sql: 执行 SQL 语句

使用规则：
1. 先了解用户的数据库结构再写 SQL（用 list_tables 和 describe_table）
2. 写 SQL 前最好先看看样例数据（用 get_table_sample）
3. SELECT 语句可以直接执行
4. INSERT/UPDATE/DELETE/DDL 等写操作，你只需要生成 SQL 并告诉用户，等待用户确认
5. 回复使用中文，简洁明了
6. 如果生成的 SQL 较复杂，简单解释一下
"""


class AiService:
    """AI 对话服务，基于 OpenAI 客户端实现 Agent 循环"""

    def __init__(self):
        self._client: AsyncOpenAI | None = None
        self._config_cache: dict | None = None

    def _get_client(self) -> AsyncOpenAI:
        """获取或创建 OpenAI 客户端"""
        config = load_ai_config()
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
        config = load_ai_config()
        return config.get("model", "deepseek-chat")

    async def chat_stream(self, message: str, chat_history: list[dict],
                          connection_id: int) -> AsyncGenerator[str, None]:
        """流式 Agent 对话，手动实现工具调用循环"""
        client = self._get_client()
        model = self._get_model()

        # 构建消息列表
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

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
                tools=TOOL_DEFINITIONS,
                stream=True,
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
                    tool_fn = TOOL_FUNCTIONS.get(tool_name)
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
