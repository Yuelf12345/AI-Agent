---
name: langchain-basics
description: This skill should be used when the user asks about "LangChain basics", "how to use LangChain", "LangChain concepts", or discusses LangChain fundamentals. Provides guidance for learning LangChain core concepts.
version: 1.0.0
---

# LangChain Basics

LangChain 基础概念学习指南。

## 核心概念

### 1. Chain（链）

链是 LangChain 的核心概念，用于将多个组件串联起来执行复杂任务。

**使用场景**：
- 多步骤数据处理流程
- LLM + Prompt + Output Parser 组合
- 顺序执行的推理任务

**代码示例**：

```typescript
import { LLMChain } from "langchain/chains";
import { OpenAI } from "langchain/llms/openai";
import { PromptTemplate } from "langchain/prompts";

const llm = new OpenAI();
const prompt = PromptTemplate.fromTemplate("翻译成英文: {text}");
const chain = new LLMChain({ llm, prompt });

const result = await chain.run("你好世界");
```

### 2. Agent（代理）

代理是能自主决策使用哪些工具的智能体。

**使用场景**：
- 需要动态选择工具的场景
- 复杂的多步骤推理任务
- 与外部系统交互

**核心组件**：
- LLM：决策大脑
- Tools：可调用的工具
- Agent Executor：执行器

### 3. Memory（记忆）

记忆让链和代理能够记住之前的交互。

**类型**：
- ConversationBufferMemory：保存完整对话
- ConversationBufferWindowMemory：保存最近 N 轮
- VectorStoreMemory：向量存储长期记忆

## 学习路径

1. **入门**：了解 Chain 和 Prompt Template
2. **进阶**：学习 Agent 和 Tools
3. **高级**：掌握 Memory 和回调系统

## 注意事项

- 使用 `.env` 文件管理 API Key
- 注意 token 消耗和成本控制
- 合理设置 temperature 参数

## 相关资源

- [LangChain 官方文档](https://js.langchain.com/)
- [LangChain GitHub](https://github.com/langchain-ai/langchainjs)
