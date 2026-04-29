<div align="center">

# 🤖 DB-Agent

**AI 驱动的轻量级数据库管理工具**

像聊天一样操作数据库，不再手写 SQL

[![](https://img.shields.io/badge/Python-3.10+-blue?logo=python&logoColor=white)](https://www.python.org/)
[![](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![](https://img.shields.io/badge/License-MIT-yellow)]()
[![](https://img.shields.io/badge/支持-MySQL%20%7C%20PostgreSQL%20%7C%20SQLite-orange)]()

</div>

---

## 它是什么？

DB-Agent 是一个**本地运行的数据库管理工具**，集成了 AI Agent 能力。

你可以把它理解为 **「DBeaver + AI」** —— 既能像传统工具一样浏览表结构、执行 SQL、导出数据，又可以通过自然语言让 AI 自动探索数据库、生成并执行查询。

**核心体验：** 用中文描述你想要的数据，AI 自主调用工具探索数据库结构，生成准确的 SQL 并执行，结果直接展示。写操作需要你确认后才执行，安全可控。

---

## 为什么做这个？

市面上的 AI 数据库工具要么是云服务（数据要上传），要么是 VS Code 插件（依赖编辑器），要么只做 SQL 生成（不能直接执行）。

DB-Agent 的设计理念：

- **本地优先** —— 运行在你自己的机器上，数据不出本地
- **开箱即用** —— 单个可执行文件，双击即用，无需安装 Node.js/Java 等运行时
- **真正可用** —— 不只是生成 SQL，而是完整的数据库管理工具，AI 是增强而非替代
- **模型自由** —— 支持任何 OpenAI 兼容 API（DeepSeek、通义千问、本地 Ollama 等）

---

## 功能预览

### 🗄️ 传统数据库管理

| 功能 | 说明 |
|------|------|
| 多数据源连接 | 支持 MySQL、PostgreSQL、SQLite，连接配置本地持久化 |
| 表结构浏览 | 侧边栏树形展示表、字段、类型、主键、注释 |
| SQL 编辑器 | CodeMirror 驱动，语法高亮、自动补全（Ctrl+Space）、多标签页 |
| 数据预览 | 点击表名即可预览数据，支持排序 |
| 单元格编辑 | 双击单元格直接编辑，自动生成带 WHERE 的 UPDATE 语句 |
| CSV 导出 | 查询结果一键导出 CSV（BOM 格式，Excel 友好） |
| SQL 历史 | 所有执行记录按连接保存，可回溯、可发送给 AI |
| DDL 查看 | 快速查看任意表的 CREATE TABLE 语句 |

### 🤖 AI 智能操作

| 功能 | 说明 |
|------|------|
| 自然语言查询 | 用中文描述需求，AI 自动生成并执行 SQL |
| 自主探索 | AI Agent 自动调用工具探索库、表、字段，理解你的数据结构 |
| 流式输出 | 打字机效果的实时响应，等待不再焦虑 |
| 写操作保护 | INSERT/UPDATE/DELETE/DDL 需弹窗确认，展示完整 SQL 后才执行 |
| 多轮对话 | 上下文连续的 AI 对话，可以追问和修正 |
| 多模型切换 | 配置多个 AI Provider，一键切换（DeepSeek / OpenAI / 本地模型等） |
| 表名拖拽 | 从侧边栏拖拽表名到对话框，让 AI 聚焦分析特定表 |

### AI Agent 工具链

AI 会自主调用以下工具完成复杂查询：

```
用户提问 → AI 思考 → 列出数据库 → 查看表结构 → 抽样数据 → 生成 SQL → 执行返回结果
```

5 个内置工具：`list_databases` → `list_tables` → `describe_table` → `get_table_sample` → `execute_sql`

---

## 快速开始

### 方式一：直接运行（推荐）

```bash
# 克隆项目
git clone https://github.com/ZCLLOVE/DB-agent.git
cd DB-agent

# 安装依赖
pip install -r requirements.txt

# 启动（自动打开浏览器）
python run.py
```

启动后浏览器会自动打开 `http://127.0.0.1:18664`

### 方式二：打包为 EXE

```bash
python -m PyInstaller build.spec
```

生成的 `dist/DB-Agent.exe` 可以分发给没有 Python 环境的用户，双击即可运行。

也可以下载我已经打包好的压缩包，解压即撸

### 配置 AI

首次使用需要配置 AI 模型：

1. 点击右上角 ⚙️ 设置图标
2. 填入你的 API 配置（以 DeepSeek 为例）：
   - **Base URL**: `https://api.deepseek.com`
   - **API Key**: 你的 API Key
   - **Model**: `deepseek-chat`
3. 保存后即可开始使用 AI 对话

> 💡 支持任何 OpenAI 兼容的 API，包括 Ollama 本地模型

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python + FastAPI + SQLAlchemy + Uvicorn |
| 前端 | 原生 JavaScript + Tailwind CSS + CodeMirror 6 |
| AI | OpenAI 兼容 API（DeepSeek / 通义千问 / Ollama 等） |
| 数据库驱动 | PyMySQL (MySQL) + psycopg2 (PostgreSQL) + aiosqlite (SQLite) |
| 打包 | PyInstaller（单文件 EXE） |

---

## 项目结构

```
DB-agent/
├── run.py                  # 启动入口
├── build.spec              # PyInstaller 打包配置
├── requirements.txt
├── static/                 # 前端静态资源
│   ├── css/style.css
│   └── js/app.js
├── app/
│   ├── main.py             # FastAPI 应用入口
│   ├── config.py           # 配置管理
│   ├── database.py         # 数据库连接池管理
│   ├── models.py           # SQLAlchemy 数据模型
│   ├── routers/            # API 路由
│   │   ├── connection.py   # 数据库连接管理
│   │   ├── table.py        # 表浏览与数据预览
│   │   ├── sql.py          # SQL 执行与历史
│   │   └── ai.py           # AI 对话与 Provider 管理
│   ├── services/           # 业务逻辑
│   │   ├── db_service.py   # 数据库操作服务
│   │   └── ai_service.py   # AI Agent 服务
│   ├── agents/
│   │   └── tools.py        # AI Agent 工具定义
│   └── templates/          # Jinja2 HTML 模板
└── data/                   # 本地数据（自动创建）
    └── dbagent.db          # SQLite 存储连接/历史/配置
```

---

## 常见问题

**Q: 支持哪些数据库？**
A: 目前支持 MySQL、PostgreSQL、SQLite。后续计划支持更多。

**Q: 数据安全吗？**
A: 所有数据存储在本地 `data/dbagent.db`，AI 对话只发送查询相关的内容到 API，不上传数据库内容。连接密码等敏感信息安全存储。

**Q: 必须联网吗？**
A: 传统数据库功能不需要联网。AI 功能需要调用 API，但如果使用 Ollama 等本地模型，也可以完全离线使用。

**Q: 可以用哪些 AI 模型？**
A: 任何 OpenAI 兼容 API 都可以：DeepSeek、通义千问、智谱 GLM、Ollama 本地模型等。

---

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

---

<div align="center">

**如果这个项目对你有帮助，给个 ⭐ Star 吧！**

</div>
