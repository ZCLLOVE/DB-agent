## 角色

你是一个全栈工程师，擅长 Python + FastAPI + LangChain 开发。

## 任务

开发一个叫 **DB-Agent**（智能数据库助手）的桌面应用。核心定位：**集成 AI 的轻量版 DBeaver**。支持传统数据库管理 + AI 自然语言操作，页面清爽简洁。项目最终打包成 **单个 exe**，拿到别人电脑双击就能用。

## 核心功能

### 1. 数据库连接管理
- 支持 MySQL、PostgreSQL、SQLite
- 新建/编辑/删除/测试连接
- 连接配置本地持久化存储
- 侧边栏快速切换已保存的连接

### 2. 传统数据库管理（DBeaver 核心功能）
- **表浏览器**：树形展示数据库 → 表 → 字段（字段名、类型、注释）
- **数据预览**：点击表名，自动加载前 200 条数据，表格展示
- **SQL 编辑器**：多 tab、语法高亮（CodeMirror 6）、可手动执行 SQL
- **查询结果**：表格展示，支持排序、快速复制单元格、导出 CSV
- **DDL 预览**：查看表的建表语句

### 3. AI 自然语言操作数据库
- 对话式交互，用户用自然语言描述需求
- AI 拥有以下工具，可自主调用：
  - `list_databases`：列出所有数据库
  - `list_tables`：列出指定数据库的所有表
  - `describe_table`：查看表结构（字段、类型、注释）
  - `get_table_sample`：获取表的样例数据
  - `execute_sql`：执行 SQL
- **SELECT 自动执行**，写操作（INSERT/UPDATE/DELETE/DDL）必须弹窗让用户确认 SQL 后才执行
- 执行结果翻译为自然语言返回，同时展示原始数据表格
- **流式输出**，打字机效果
- 支持多轮对话，保留上下文

### 4. 其他
- SQL 执行历史
- 导出查询结果为 CSV
- 支持同时打开多个 SQL tab

## 技术架构（纯 Python，无前端构建）

- **后端**：FastAPI + Jinja2 + SQLAlchemy + LangChain
- **前端**：Jinja2 模板 + 原生 JS + Tailwind CSS（CDN）+ CodeMirror 6（CDN）
- **数据库驱动**：`pymysql`、`psycopg2-binary`、`sqlite3`
- **AI 模型**：DeepSeek（OpenAI 兼容 API，用户自己填 API Key）
- **打包**：PyInstaller → 单 exe

## 页面布局（参考 DBeaver，但更简洁）

```
┌──────────────────────────────────────────────┐
│  顶部栏：连接选择 / AI对话按钮 / 设置(齿轮)    │
├──────────┬───────────────────────────────────┤
│          │  SQL编辑器 / AI对话（tab切换）       │
│  侧边栏  │  [SQL Tab1] [SQL Tab2] [AI 对话]   │
│          ├───────────────────────────────────┤
│  表浏览器 │  查询结果 / AI回复                   │
│  树形结构 │  表格展示 或 流式对话气泡             │
│          │                                    │
└──────────┴───────────────────────────────────┘
```

## 设计风格

- **暗色主题**，参考 DataGrip/DBeaver 暗色模式，但更干净
- 不要花哨的动效，注重信息密度和可读性
- 代码区域等宽字体，数据区域清晰对齐
- AI 对话区域用气泡样式，SQL 用代码块高亮展示
- 整体紧凑，多留给数据展示空间

## 安全要求

- 写操作（INSERT/UPDATE/DELETE/DDL）必须有用户确认，弹窗显示 SQL，确认后才执行
- 所有 SQL 执行记录可追溯（本地日志）
- API Key 仅本地 SQLite 存储，不上传

## 项目结构

```
db-agent/
├── app/
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置管理
│   ├── database.py          # 数据库连接池管理
│   ├── models.py            # SQLAlchemy 本地存储模型
│   ├── routers/
│   │   ├── connection.py    # 连接管理接口
│   │   ├── table.py         # 表浏览接口
│   │   ├── sql.py           # SQL 执行接口
│   │   └── ai.py            # AI 对话接口
│   ├── services/
│   │   ├── db_service.py    # 数据库操作服务
│   │   └── ai_service.py    # LangChain Agent 服务
│   ├── agents/
│   │   └── tools.py         # AI Agent 自定义工具
│   └── templates/
│       ├── base.html
│       └── index.html
├── static/
│   ├── css/style.css
│   └── js/app.js
├── requirements.txt
├── build.spec              # PyInstaller 配置
└── README.md
```

## 打包要求

- PyInstaller 打包成单个 exe（`--onefile`）
- 前端模板和静态资源全部打包进 exe
- 数据库驱动打包（`--hidden-import`）
- 生成 `requirements.txt`

## 要求

1. 生成完整可运行的项目代码
2. 每步完成后自主测试验证
3. 代码有中文注释
4. 页面清爽简洁，像一个正经的工具软件
