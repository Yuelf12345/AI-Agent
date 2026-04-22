# 个人知识管家 (Personal Knowledge Butler)

## 技术设计文档 v1.0

---

## 1. 项目概述

### 1.1 愿景

构建一个完全本地运行的个人智能助理，统一接管笔记、文档、待办、日程，以隐私优先的方式提供 AI 增强的知识管理体验。

### 1.2 核心原则

- **本地优先**：所有数据、模型、计算都在本地（或用户可控的私有服务器）
- **渐进增强**：基础功能无需 AI，AI 作为增强层按需启用
- **Harness 架构**：模块化设计，Tools 可插拔，Agent 可编排
- **开放格式**：数据使用 Markdown、JSON 等开放格式，用户随时可导出

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       前端层 (Tauri App)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  笔记编辑器  │  │  对话界面   │  │   系统设置面板       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                     Harness Core Layer                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Agent 编排  │  │  Tool 注册  │  │    Memory 管理       │ │
│  │  (LangGraph)│  │    中心     │  │ (上下文/长期记忆)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   Tool Layer  │  │   LLM Layer   │  │ Storage Layer │
│ ┌─────────┐   │  │ ┌─────────┐   │  │ ┌─────────┐   │
│ │FileTool │   │  │ │ Ollama  │   │  │ │ Chroma  │   │
│ │NoteTool │   │  │ │ Adapter │   │  │ │ (向量)  │   │
│ │TodoTool │   │  │ └─────────┘   │  │ └─────────┘   │
│ │Search  │   │  │ ┌─────────┐   │  │ ┌─────────┐   │
│ │ Tool   │   │  │ │ OpenAI  │   │  │ │ SQLite  │   │
│ └─────────┘   │  │ │Adapter │   │  │ │(关系)   │   │
└───────────────┘  │ └─────────┘   │  │ └─────────┘   │
                   └───────────────┘  └───────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 关键技术 |
|------|------|----------|
| **Agent Engine** | 意图识别、任务规划、工具调度 | LangGraph / 自研 StateGraph |
| **Tool Registry** | Tool 发现、注册、权限管理 | 动态导入 + JSON Schema |
| **Memory System** | 短期上下文 + 长期知识库 | Chroma + SQLite |
| **File Watcher** | 监听本地文件变化、自动索引 | notify-rs (Rust) |
| **LLM Router** | 模型选择、fallback、成本控制 | 配置化路由策略 |

---

## 3. 核心 Harness 设计

### 3.1 Tool 抽象

每个 Tool 是一个独立的功能单元，具备以下属性：

```yaml
tool:
  name: "note_search"           # 唯一标识
  description: "搜索笔记内容"    # LLM 可读的描述
  parameters:                   # JSON Schema 定义
    type: object
    properties:
      query: { type: string }
      date_range: { type: string }
  handler: "tools.note.search"  # 实际执行函数
  permissions: ["read:notes"]   # 权限声明
  local_only: true              # 是否纯本地执行
```

内置 Tools 规划：

| Tool | 功能 | 输入 | 输出 |
|------|------|------|------|
| `file_read` | 读取本地文件 | `path` | `content` |
| `file_write` | 写入本地文件 | `path, content` | `success` |
| `note_search` | 语义搜索笔记 | `query` | `matches[]` |
| `note_create` | 创建新笔记 | `title, content` | `note_id` |
| `todo_extract` | 从文本提取待办 | `text` | `todos[]` |
| `calendar_query` | 查询日程 | `date_range` | `events[]` |
| `web_search` | 网络搜索（可选） | `query` | `results[]` |

### 3.2 Agent 设计

采用 ReAct + Plan-and-Solve 混合模式：

```
用户输入 ──▶ Intent Router ──┬──▶ 简单任务 ──▶ 单 Tool 执行
                             │
                             └──▶ 复杂任务 ──▶ Planning Agent
                                                   │
                             ┌─────────────────────┘
                             ▼
                        ┌─────────────┐
                        │ 分解为子任务  │
                        └──────┬──────┘
                               │
                   ┌───────────┼───────────┐
                   ▼           ▼           ▼
              ┌───────┐   ┌───────┐   ┌───────┐
              │Task 1 │   │Task 2 │   │Task 3 │
              └───┬───┘   └───┬───┘   └───┬───┘
                  │           │           │
                  └───────────┼───────────┘
                              ▼
                        ┌─────────────┐
                        │ 结果汇总输出  │
                        └─────────────┘
```

Agent 状态机：

```yaml
states:
  - IDLE          # 等待输入
  - PLANNING      # 规划阶段
  - EXECUTING     # 执行 Tool
  - OBSERVING     # 观察结果
  - RESPONDING    # 生成回复
  - WAITING_HUMAN # 等待人工确认

transitions:
  IDLE -> PLANNING: 收到用户输入
  PLANNING -> EXECUTING: 定执行计划
  EXECUTING -> OBSERVING: Tool 返回结果
  OBSERVING -> EXECUTING: 需要继续执行
  OBSERVING -> RESPONDING: 任务完成
  EXECUTING -> WAITING_HUMAN: 需要确认（如删除文件）
```

### 3.3 Skills 规则系统

Skills 是一组预定义的行为模式，用于指导 Agent 在特定场景下的行为。

#### 3.3.1 Skill 抽象

每个 Skill 定义了特定领域的知识和行为规则：

```yaml
skill:
  name: "note_management"          # 唯一标识
  description: "笔记管理技能"       # 技能描述
  domain: "knowledge"             # 所属领域
  triggers:                       # 触发条件
    - intent: ["create_note", "search_note", "update_note"]
    - keywords: ["笔记", "note", "记录"]
  
  rules:                          # 行为规则
    - name: "auto_tag"
      condition: "note.content contains '会议'"
      action: "add_tag('meeting')"
    
    - name: "auto_backup"
      condition: "note.content.length > 1000"
      action: "trigger_backup(note)"
  
  tools: ["note_create", "note_search", "note_update"]  # 关联的 Tools
  priority: 10                    # 优先级（越高越优先）
```

#### 3.3.2 内置 Skills 规划

| Skill | 功能 | 触发场景 | 关联 Tools |
|-------|------|----------|------------|
| `note_management` | 笔记创建、搜索、更新 | "帮我记一下..."、"找笔记..." | note_create, note_search |
| `task_extraction` | 从文本提取待办事项 | "从中提取待办..." | todo_extract |
| `calendar_query` | 日程查询与管理 | "明天有什么安排..." | calendar_query |
| `knowledge_search` | 知识库语义检索 | "什么是..."、"解释..." | note_search, web_search |
| `file_management` | 本地文件操作 | "读取文件..."、"保存..." | file_read, file_write |

#### 3.3.3 Skills 与 Agent 的协作

```
用户输入 ──▶ Intent Router ──┬──▶ 匹配 Skill ──▶ 加载规则
                            │                       │
                            │                       ▼
                            │               应用规则约束 Agent 行为
                            │                       │
                            └───────────────────────┼──▶ Tool 执行
                                                    │
                                                    ▼
                                            结果后处理（规则检查）
```

#### 3.3.4 Skills 生命周期

```yaml
skill_lifecycle:
  states:
    - REGISTERED     # 已注册，未激活
    - ACTIVE         # 激活中
    - SUSPENDED     # 暂停
    - DEPRECATED    # 已弃用
  
  transitions:
    REGISTERED -> ACTIVE: 用户启用或自动触发
    ACTIVE -> SUSPENDED: 用户暂停或冲突降级
    SUSPENDED -> ACTIVE: 用户重新启用
    ACTIVE -> DEPRECATED: 版本更新后自动废弃
```

### 3.4 Memory 系统

双层记忆架构：

**Layer 1: 工作记忆（Working Memory）**

- 当前对话的上下文窗口
- 最近 10 轮对话
- 当前任务的中间状态

**Layer 2: 长期记忆（Long-term Memory）**

- 笔记内容的向量索引（Chroma）
- 对话历史的摘要（按主题聚类）
- 用户偏好学习（常用的 Tools、文件路径）

记忆检索策略：

1. 先查工作记忆（精确匹配）
2. 再查长期记忆（语义相似度 Top-5）
3. 结合时间衰减（越近的记忆权重越高）

---

## 4. 数据模型

### 4.1 核心实体

```yaml
# Note 笔记
note:
  id: uuid
  title: string
  content: string          # Markdown 格式
  tags: string[]
  created_at: timestamp
  updated_at: timestamp
  embedding_id: string     # 指向 Chroma 的向量
  file_path: string        # 本地文件路径（可选）

# Task 任务
task:
  id: uuid
  content: string
  source: string           # 从哪提取的（邮件/聊天/笔记）
  status: todo|doing|done
  priority: low|medium|high
  due_date: timestamp|null
  extracted_by: agent_id   # 提取的 Agent

# Conversation 对话
conversation:
  id: uuid
  title: string            # AI 自动生成
  messages: Message[]
  created_at: timestamp

Message:
  role: user|assistant|tool
  content: string
  tool_calls: ToolCall[]   # assistant 调用的 tool
  tool_result: any         # tool 返回的结果
  timestamp: timestamp
```

### 4.2 向量索引设计

```yaml
# Chroma Collection: notes
embedding:
  document: note.content   # 索引内容
  metadata:
    note_id: uuid
    title: string
    tags: string[]
    created_at: timestamp

# 检索参数
search:
  top_k: 5
  threshold: 0.7           # 相似度阈值
  filter:                  # 元数据过滤
    tags: {$in: ["work"]}
```

---

## 5. 接口设计（高层）

### 5.1 Core API (Express.js)

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 发起对话 |
| `GET` | `/api/conversations` | 获取对话列表 |
| `GET` | `/api/conversations/:id` | 获取对话详情 |
| `POST` | `/api/tools/invoke` | 直接调用 Tool |
| `GET` | `/api/notes` | 搜索笔记 |
| `POST` | `/api/notes` | 创建笔记 |

### 5.2 Node.js 项目结构

```
src/
├── index.ts                 # 入口，Express 服务启动
├── config/
│   └── index.ts             # 配置管理（端口、模型地址等）
├── api/
│   ├── chat.ts              # /api/chat 路由
│   ├── conversations.ts     # 对话管理路由
│   ├── tools.ts             # Tool 调用路由
│   └── notes.ts             # 笔记管理路由
├── harness/
│   ├── agent/
│   │   ├── index.ts         # Agent 主类
│   │   ├── react.ts         # ReAct 循环实现
│   │   └── planner.ts       # 任务规划
│   ├── tool/
│   │   ├── registry.ts      # Tool 注册中心
│   │   ├── base.ts          # Tool 基类
│   │   └── builtin/         # 内置 Tools
│   │       ├── file.ts
│   │       ├── note.ts
│   │       └── search.ts
│   ├── skills/
│   │   ├── registry.ts      # Skills 注册中心
│   │   ├── base.ts          # Skill 基类与接口定义
│   │   ├── loader.ts        # 动态加载器
│   │   └── builtin/         # 内置 Skills
│   │       ├── note_management.ts    # 笔记管理技能
│   │       ├── task_extraction.ts    # 待办提取技能
│   │       ├── calendar_query.ts     # 日程查询技能
│   │       └── knowledge_search.ts   # 知识检索技能
│   └── memory/
│       ├── working.ts       # 工作记忆
│       └── longterm.ts      # 长期记忆（Chroma 封装）
├── services/
│   ├── llm.ts               # LLM 路由（Ollama/OpenAI）
│   ├── storage.ts           # SQLite 封装
│   └── vector.ts            # Chroma 向量库封装
└── types/
    └── index.ts             # 类型定义
```

**POST /api/chat**

```json
// Request
{ "message": "string", "conversation_id": "uuid?" }

// Response: Stream<Event>  SSE 流式返回
```

**POST /api/tools/invoke**

```json
// Request
{ "tool_name": "string", "parameters": "object" }
```

**GET /api/notes**

```
Query: { q: string, tags?: string[] }
```

### 5.2 Event 流格式

```json
// 思考过程
{ "type": "thought", "content": "用户想查找上周的会议记录..." }

// Tool 调用
{ "type": "tool_call", "tool": "note_search", "parameters": {...} }

// Tool 结果
{ "type": "tool_result", "tool": "note_search", "result": [...] }

// 最终回复
{ "type": "message", "role": "assistant", "content": "..." }

// 错误
{ "type": "error", "code": "TOOL_FAILED", "message": "..." }
```

---

## 6. 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 桌面框架 | Tauri | Rust 核心，体积小，性能好，前端用 React |
| 后端 | Node.js + TypeScript | 统一技术栈，LangChain.js 生态成熟 |
| 向量数据库 | Chroma | 纯本地运行，无需额外服务 |
| 关系数据库 | SQLite | 零配置，单文件，备份简单 |
| 本地 LLM | Ollama | 一键运行开源模型，API 兼容 OpenAI |
| 任务队列 | 可选 Celery | 文件索引等重任务异步处理 |
| 文件监听 | notify (Rust) | Tauri 内置，跨平台可靠 |

---

## 7. 开发里程碑

### Phase 1: 基础 Harness（Week 1）

- [x] Express 服务框架搭建
- [ ] Tool Registry 实现
- [ ] 基础 Tools：`file_read`, `file_write`, `note_search`
- [ ] ReAct Agent 循环（LangChain.js）
- [ ] 简单 CLI/HTTP 交互

### Phase 2: 桌面应用（Week 2）

- Tauri 框架搭建
- 笔记编辑器（Markdown）
- 对话界面
- 文件自动索引

### Phase 3: AI 增强（Week 3）

- Ollama 集成
- 智能标签/摘要
- 待办自动提取
- 语义搜索

### Phase 4: 高级功能（Week 4）

- 多 Agent 协作
- 人机确认机制
- 数据导出/备份
- 插件系统 MVP

---

## 8. 非功能性需求

### 8.1 隐私安全

- 默认离线运行，无云端依赖
- 网络请求（如搜索）需用户明确授权
- 敏感操作（删除、发送）需二次确认

### 8.2 性能目标

- 应用启动 < 3s
- 笔记搜索 < 500ms
- AI 响应首字节 < 2s（本地 7B 模型）

### 8.3 可扩展性

- Tool 接口开放，第三方可开发插件
- LLM Router 支持多模型切换
- 存储层抽象，可替换为 PostgreSQL 等

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| 本地模型性能不足 | 支持 OpenAI API 作为备选，配置化切换 |
| 大文件索引慢 | 增量索引 + 异步队列，避免阻塞 UI |
| 用户数据丢失 | 自动备份 + Git 集成，版本可追溯 |
| Tool 权限滥用 | 细粒度权限控制 + 危险操作人工确认 |

---

## 10. 核心功能学习与实现指南

本项目需重点学习并实现三大核心功能：多 Agent 协作、Memory 管理、高级 RAG。

### 10.1 多 Agent 协作

#### 10.1.1 核心概念

| 概念 | 说明 |
|------|------|
| **ReAct 模式** | Reasoning → Acting → Observing 循环，先思考再行动 |
| **Intent Router** | 识别用户意图，分发到不同 Agent 处理 |
| **Planning Agent** | 复杂任务分解为子任务，协调多 Agent 并行执行 |
| **LangGraph StateGraph** | 状态机编排多 Agent 流程，定义状态节点与转换边 |

#### 10.1.2 Agent 状态机设计

```
┌─────────┐     用户输入      ┌─────────┐
│  IDLE   │ ───────────────▶ │ROUTING  │
└─────────┘                  └────┬────┘
     ▲                            │
     │                       ┌────┴────┐
     │                       ▼         ▼
     │                 ┌─────────┐ ┌─────────┐
     │                 │SIMPLE   │ │PLANNING │
     │                 │AGENT    │ │AGENT    │
     │                 └────┬────┘ └────┬────┘
     │                      │           │
     │                      ▼           ▼
     │                 ┌─────────────────┐
     │                 │   EXECUTING     │
     │                 │   (Tool 调用)    │
     │                 └────────┬────────┘
     │                          │
     │                          ▼
     │                 ┌─────────────────┐
     └─────────────────│   RESPONDING    │
                       └─────────────────┘
```

#### 10.1.3 实现路径

```
src/harness/agent/
├── index.ts        # Agent 主类，协调各组件
├── react.ts        # ReAct 循环实现
├── planner.ts      # 任务规划器（复杂任务分解）
├── router.ts       # 意图路由器（简单/复杂任务分发）
└── state.ts        # 状态定义与转换逻辑
```

#### 10.1.4 关键代码参考

| 文件 | 说明 |
|------|------|
| `LangChain/src/templates/s11_autonomous_agents.ts` | 单 Agent 基础实现 |
| `LangChain/src/templates/10.teams_protocols.ts` | 多 Agent 协作示例（消息传递） |
| `LangChain/src/templates/s12_worktree_task_isolation.ts` | 任务隔离与并行执行 |

#### 10.1.5 学习资源

- [LangGraph.js 官方文档](https://langchain-ai.github.io/langgraphjs/)
- [LangChain.js Agent 指南](https://js.langchain.com/docs/how_to/agents)

---

### 10.2 Memory 管理

#### 10.2.1 双层记忆架构

| 层级 | 存储 | 用途 | 保留策略 |
|------|------|------|----------|
| **Working Memory** | 内存 | 当前对话上下文 | 最近 10 轮对话 |
| **Long-term Memory** | Chroma | 笔记向量索引、对话摘要 | 持久化存储 |

#### 10.2.2 工作记忆设计

```typescript
interface WorkingMemory {
  conversationId: string;
  messages: Message[];           // 对话历史
  currentTask: Task | null;      // 当前任务状态
  toolResults: ToolResult[];     // Tool 调用结果缓存
  metadata: {
    startTime: Date;
    turnCount: number;
  };
}
```

#### 10.2.3 长期记忆设计

```yaml
# Chroma Collection 配置
collections:
  - name: notes
    embedding: nomic-embed-text  # 本地 Embedding 模型
    metadata:
      - note_id
      - title
      - tags[]
      - created_at
      
  - name: conversations
    embedding: nomic-embed-text
    metadata:
      - conversation_id
      - topic
      - date

# 检索策略
retrieval:
  top_k: 5
  threshold: 0.7
  time_decay: true              # 时间衰减权重
  decay_factor: 0.95
```

#### 10.2.4 记忆检索流程

```
用户查询 ──▶ 工作记忆匹配 ──┬──▶ 精确匹配 ──▶ 直接返回
                          │
                          └──▶ 无匹配 ──▶ 长期记忆检索
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
                    向量相似度检索                           时间衰减加权
                    (Chroma Top-5)                          (权重 = 0.95^n)
                          │                                       │
                          └───────────────────┬───────────────────┘
                                              ▼
                                        合并排序返回
```

#### 10.2.5 实现路径

```
src/harness/memory/
├── working.ts      # 工作记忆管理
├── longterm.ts     # 长期记忆（Chroma 封装）
├── summarizer.ts   # 对话摘要生成
└── retrieval.ts    # 检索策略实现
```

#### 10.2.6 学习资源

- [LangChain.js Memory 概念](https://js.langchain.com/docs/concepts/memory)
- [Chroma 官方文档](https://docs.trychroma.com/)

---

### 10.3 高级 RAG（检索增强生成）

#### 10.3.1 RAG 管道设计

```
┌─────────────────────────────────────────────────────────────┐
│                       RAG Pipeline                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ Document│───▶│ Chunking│───▶│Embedding│───▶│  Vector │  │
│  │  Input  │    │  Split   │    │  Model  │    │  Store  │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  Query  │───▶│ Embed   │───▶│Retrieve │───▶│Re-rank  │  │
│  │  Input  │    │ Query   │    │ Top-K   │    │ Results │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                      │                       │
│                                      ▼                       │
│                              ┌─────────────┐               │
│                              │    LLM      │               │
│                              │ Generation  │               │
│                              └─────────────┘               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 10.3.2 文档分块策略

| 文档类型 | 分块方式 | Chunk Size | Overlap |
|----------|----------|------------|---------|
| Markdown | 按 Header 拆分 | 500 tokens | 50 tokens |
| 纯文本 | 递归字符拆分 | 1000 chars | 200 chars |
| 代码文件 | 按 AST 节点 | 函数/类级别 | - |

```typescript
// Markdown 按 Header 分块示例
import { MarkdownHeaderTextSplitter } from "@langchain/textsplitters";

const splitter = new MarkdownHeaderTextSplitter([
  ["#", "header1"],
  ["##", "header2"],
  ["###", "header3"],
]);
```

#### 10.3.3 混合检索策略

| 检索方式 | 适用场景 | 权重 |
|----------|----------|------|
| **向量检索** | 语义相似查询 | 0.7 |
| **BM25 检索** | 关键词精确匹配 | 0.3 |

```typescript
// 混合检索示例
const vectorResults = await chromaCollection.query({
  queryEmbeddings: queryEmbedding,
  nResults: 10,
});

const bm25Results = await bm25Index.search(query, 10);

// 加权融合
const finalResults = weightedFuse(vectorResults, bm25Results, {
  vectorWeight: 0.7,
  bm25Weight: 0.3,
});
```

#### 10.3.4 重排序策略

```yaml
reranking:
  factors:
    - semantic_score: 0.4      # 语义相似度
    - time_decay: 0.3          # 时间衰减
    - tag_match: 0.2           # 标签匹配
    - source_priority: 0.1     # 来源优先级
  
  time_decay:
    formula: score * 0.95^n    # n = 天数
    
  tag_match:
    boost: 1.5                 # 标签匹配时的提升倍数
```

#### 10.3.5 实现路径

```
src/services/
├── vector.ts       # Chroma 向量库封装
├── embedding.ts    # Embedding 模型封装（Ollama）
└── rag/
    ├── chunker.ts  # 文档分块器
    ├── retriever.ts # 混合检索器
    └── reranker.ts # 重排序器
```

#### 10.3.6 学习资源

- [LangChain.js RAG 教程](https://js.langchain.com/docs/tutorials/rag)
- [Chroma Embedding 指南](https://docs.trychroma.com/embeddings)

---

### 10.4 Skills 系统学习与实现

#### 10.4.1 核心概念

| 概念 | 说明 |
|------|------|
| **Skill** | 领域特定的行为模式，包含规则和触发条件 |
| **Rule Engine** | 规则引擎，评估条件并执行对应动作 |
| **Trigger Matcher** | 匹配用户意图与 Skill 触发条件 |
| **Priority Queue** | 按优先级调度激活的 Skills |

#### 10.4.2 Skills 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     Skills Layer                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Trigger   │───▶│   Skill     │───▶│   Rule Engine   │  │
│  │   Matcher   │    │   Registry  │    │   (Evaluator)   │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         │                  │                     │         │
│         ▼                  ▼                     ▼         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Priority Scheduler                      │   │
│  │  (按优先级排序激活的 Skills，处理冲突)                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 10.4.3 规则定义示例

```typescript
interface SkillRule {
  name: string;
  condition: string | RegExp | ((context: SkillContext) => boolean);
  action: string | ((context: SkillContext) => Promise<void>);
  priority?: number;
}

// 示例：笔记自动标签规则
const autoTagRule: SkillRule = {
  name: "auto_meeting_tag",
  condition: (ctx) => /会议|meeting|周会/.test(ctx.note?.content || ""),
  action: async (ctx) => {
    ctx.note?.tags.push("meeting");
  },
  priority: 10
};
```

#### 10.4.4 Skills 与 Tools 的关系

```
┌──────────────┐     激活/约束      ┌──────────────┐
│    Skill     │ ─────────────────▶│    Agent     │
│  (行为模式)   │                    │   (执行者)    │
└──────────────┘                    └──────┬───────┘
       │                                   │
       │ 关联                              │ 调用
       ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│    Tools     │ ◀─────────────────│   Tools      │
│  (能力单元)   │    定义可用工具     │  (执行)      │
└──────────────┘                    └──────────────┘
```

**Skills vs Tools：**
- **Tools**：原子操作，无状态，可被直接调用
- **Skills**：行为模式，有状态，包含规则和上下文

#### 10.4.5 实现路径

```
src/harness/skills/
├── registry.ts      # Skills 注册中心（发现、注册、查询）
├── base.ts          # Skill 基类、Rule 接口定义
├── loader.ts        # 动态加载器（从文件/目录加载 Skills）
├── matcher.ts       # 触发匹配器（意图识别、关键词匹配）
├── engine.ts        # 规则引擎（条件评估、动作执行）
└── builtin/         # 内置 Skills 实现
    ├── note_management.ts
    ├── task_extraction.ts
    ├── calendar_query.ts
    └── knowledge_search.ts
```

#### 10.4.6 Skills 学习重点

| 学习点 | 内容 | 参考资源 |
|--------|------|----------|
| **规则引擎设计** | 条件表达式解析、优先级冲突解决 | Drools (Java) 设计模式 |
| **动态加载** | ES Module 动态导入、热更新 | Node.js import() API |
| **意图匹配** | 关键词匹配 vs 语义相似度 | LangChain Intent Router |
| **状态管理** | Skill 激活状态、上下文保持 | LangGraph State |

---

### 10.5 学习顺序建议

| 阶段 | 功能模块 | 学习重点 | 预计产出 |
|------|----------|----------|----------|
| **阶段 1** | Memory 管理 | Working Memory + Chroma 集成 | 对话历史持久化 |
| **阶段 2** | Skills 系统 | Skill 注册 + 规则引擎 + 触发机制 | 领域行为自动化 |
| **阶段 3** | RAG | Embedding + 向量检索 + 分块 | 笔记语义搜索 |
| **阶段 4** | 多 Agent | StateGraph + ReAct + Planner | 复杂任务分解执行 |

---

## 11. 附录

### 11.1 术语表

| 术语 | 定义 |
|------|------|
| Harness | AI Agent 的运行框架，负责 Tool 管理、状态流转、记忆存储 |
| Tool | 可被 Agent 调用的功能单元，有明确的输入输出定义 |
| ReAct | Reasoning + Acting，先思考再行动的 Agent 模式 |

### 11.2 参考项目

| 项目 | 参考方向 |
|------|----------|
| OpenClaw | Harness 架构参考 |
| Obsidian | 笔记管理交互参考 |
| Claude Desktop | 本地 AI 助手参考 |
| LangChain.js | Node.js AI 编排 |

### 11.3 Node.js 依赖清单

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "langchain": "^0.3.0",
    "@langchain/ollama": "^0.1.0",
    "@langchain/openai": "^0.3.0",
    "chromadb": "^1.8.0",
    "chromadb-default-embed": "^2.13.0",
    "better-sqlite3": "^9.4.0",
    "chokidar": "^3.6.0",
    "uuid": "^9.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/uuid": "^9.0.7",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0"
  }
}
```

---

> 文档版本: 1.1 | 最后更新: 2026-04-22 | 下一步: 按 Memory → RAG → Agent 顺序实现核心功能