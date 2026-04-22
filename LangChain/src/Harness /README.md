# Personal Knowledge Butler

基于 Harness 架构的个人知识管家，本地优先的 AI 增强知识管理系统。

## 功能特性

- **本地优先**: 所有数据和计算都在本地完成，保护隐私
- **Harness 架构**: 模块化的 Agent 设计，Tools 和 Skills 可插拔
- **多 Agent 协作**: ReAct + Planning 混合模式处理复杂任务
- **智能记忆**: 工作记忆 + 长期记忆双层架构
- **语义检索**: 基于 Chroma 的高级 RAG 检索

## 项目结构

```
src/
├── index.ts              # 应用入口
├── config/               # 配置管理
├── api/                  # REST API 路由
│   ├── chat.ts          # 对话接口
│   ├── conversations.ts # 对话管理
│   ├── tools.ts         # Tool 调用
│   └── notes.ts         # 笔记管理
├── harness/             # 核心 Harness 层
│   ├── agent/           # Agent 实现
│   ├── tool/            # Tool 系统
│   ├── skills/          # Skills 规则系统
│   └── memory/          # Memory 管理
└── services/            # 服务层
    ├── llm.ts           # LLM 服务
    ├── storage.ts       # SQLite 存储
    └── vector.ts        # Chroma 向量库
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 配置你的 LLM 和存储路径
```

### 3. 启动服务

```bash
npm run dev
```

### 4. 测试 API

```bash
# 健康检查
curl http://localhost:3000/api/health

# 发起对话
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我记一下明天的会议"}'
```

## API 文档

### POST /api/chat

发起对话，返回 SSE 流式响应。

```json
{
  "message": "string",
  "conversation_id": "uuid (optional)"
}
```

### GET /api/conversations

获取对话列表。

### GET /api/notes

搜索笔记。

```
GET /api/notes?q=关键词&tags=work,meeting
```

### POST /api/tools/invoke

直接调用 Tool。

```json
{
  "tool_name": "string",
  "parameters": {}
}
```

## 开发计划

- [x] Phase 1: 基础 Harness 框架
- [ ] Phase 2: LLM 集成 (Ollama/OpenAI)
- [ ] Phase 3: 向量检索 (Chroma)
- [ ] Phase 4: 多 Agent 协作

## 许可证

MIT
