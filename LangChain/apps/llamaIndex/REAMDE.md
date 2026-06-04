常用管理命令汇总
命令	                    作用
ollama list	            查看已拉取的模型列表
ollama pull qwen2.5:7b	拉取/下载模型
ollama run qwen2.5:7b	交互式运行模型
ollama stop qwen2.5:7b	从内存卸载模型
ollama rm qwen2.5:7b	删除模型文件（慎用）
ollama serve	        启动后台服务
ollama ps	            查看当前内存中正在运行的模型

# 查看所有进程按内存排序（macOS）
top -l 1 -stats pid,command,mem -n 10

# 只看 ollama 占多少内存
ps aux | grep ollama

# 内存概况
memory-pressure

## LlamaIndex 是什么？

**LlamaIndex** 是一个**开源的数据编排框架**，专门用于构建大语言模型 (LLM) 应用程序。它提供 Python 和 TypeScript 两种版本，核心目标是通过**检索增强生成 (RAG)** 流程，将**私有或自定义数据**与 LLM 连接起来，让 LLM 能够访问和理解用户自己的数据。

你可以把它理解为"连接 LLM 和你的数据的桥梁"——你的 PDF、数据库、API 等各种来源的数据，经过 LlamaIndex 的编排后，LLM 就能基于这些数据进行问答、分析和推理。一个功能完善的 RAG 框架，提供从数据采集、清洗、集成到检索的全流程支持，并具有一定的 agent 能力，提升其在不同使用场景中的灵活性和适应性。

---

## LlamaIndex 的主要模块/功能

LlamaIndex 的核心模块可以分为以下 **7 大模块**：

### 1. 数据连接器（Data Connectors / Loaders）
- 负责从各种数据源**加载数据**
- 支持 **160+ 种数据格式**（PDF、Word、Markdown、SQL、API、图像、音频、视频等）
- 通过 **LlamaHub**（开源数据加载器注册表）扩展更多的数据连接器

### 2. 索引模块（Indexes）
- 将加载的数据转换为 LLM 可检索的结构
- 主要索引类型：
  - **矢量存储索引（VectorStoreIndex）**：将数据分块 → 创建嵌入向量 → 支持语义搜索
  - **摘要索引（Summary Index）**：存储文档摘要
  - **知识图谱索引（Knowledge Graph Index）**：抽取实体关系，构建知识图谱
- 支持多种矢量数据库集成（Pinecone、Chroma、Weaviate 等）

### 3. 查询引擎（Query Engine）
- 允许用户用**自然语言提问**，返回上下文丰富的答案
- 查询流程分三阶段：
  1. **检索**：从索引中获取最相关的文档
  2. **后处理**：重新排序、过滤、转换检索结果
  3. **响应合成**：将数据和提示组合发送给 LLM，生成最终回答
- 提供多种专项查询引擎（如 JSON 查询引擎、结构化数据引擎）

### 4. 聊天引擎（Chat Engine）
- 查询引擎的**有状态版本**，支持多轮对话
- 维护对话历史，实现类似 ChatGPT 的交互体验
- 支持 ReAct 代理模式

### 5. 数据代理（Data Agents / AI 智能体）
- **LLM 驱动的 AI 代理**，能自主执行多步骤数据任务
- 支持 **ReAct（推理+行动）模式**和 **OpenAI Function Calling**
- 核心组件：
  - **推理循环**：决定用哪些工具、什么顺序、什么参数
  - **工具抽象**：包括 `FunctionTool`（封装任意函数）、`QueryEngineTool`（封装查询引擎）
  - **ToolSpecs**：定义完整的 API 规范（如 Gmail 工具规范支持读/写/发邮件）

### 6. LLM 集成（LLM Integration）
- 支持与多种 LLM 集成：OpenAI、IBM Granite、Llama2、Ollama 等
- 也可与其他框架协同：**LangChain**、Ollama
- LLM 可作为独立模块使用，也可插入到其他核心模块

### 7. 数据提取（Structured Data Extraction）
- LLM 从非结构化文本中提取**结构化信息**（名称、日期、地址、数字等）
- 支持 **Text-to-SQL**、**Text-to-Pandas** 在结构化数据上查询
- 配合 **LlamaParse** 解析复杂文档（嵌套表格、多模态内容、手写笔记等）

---

## 架构关系
The user is asking about what LlamaIndex is and what modules/features it has. I've gathered enough information from the IBM article and search results. Let me provide a comprehensive answer in Chinese.
## LlamaIndex 是什么？

**LlamaIndex** 是一个**开源的数据编排框架**（Data Framework），用于构建大语言模型（LLM）应用程序。它提供 Python 和 TypeScript 两种版本，核心目标是**解决 LLM 如何接入和利用私有/自定义数据**的问题。

简单理解：如果说 LLM 是一个"大脑"，LlamaIndex 就是帮这个大脑连接"外部知识库"的桥梁，最典型的应用场景就是 **RAG（检索增强生成）**。

---

## 核心模块

### 1. 数据接入层 — Data Connectors（数据连接器）

- 支持 **160+ 种**不同数据格式（PDF、Word、Markdown、SQL、API、图片、音频等）
- 通过 **LlamaHub**（开源数据加载器注册表）提供丰富的连接器
- 数据被加载后转化为统一的 **Document** 对象

### 2. 索引构建层 — Indexing

将数据转换为 LLM 可检索的结构，支持多种索引类型：

| 索引类型 | 说明 |
|---------|------|
| **矢量存储索引** | 最常用，将文本分块后转为矢量嵌入，支持语义搜索 |
| **摘要索引** | 对每个文档生成摘要，适用于概要查询 |
| **知识图谱索引** | 构建实体关系图，适合关联查询 |

### 3. 存储层 — Storage

- 默认**内存存储**
- 支持集成多种**矢量数据库**（如 Pinecone、Chroma、Weaviate 等）

### 4. 查询与交互层 — Query Interface

- **查询引擎（Query Engine）**：单次问答，支持自然语言查询
- **聊天引擎（Chat Engine）**：有状态的多轮对话
- **JSON 查询引擎**：针对结构化数据

### 5. 数据代理 — Data Agents（AI Agent）

LLM 驱动的自主智能体，能力包括：
- **推理循环（ReAct）**：边推理边行动，多步决策
- **工具抽象**：`FunctionTool`（将任意函数转工具）、`QueryEngineTool`（将查询引擎转工具）
- **ToolSpecs**：完整的 API 封装（如 Gmail 工具规范可收发邮件）
- 支持 **15+ 种工具规范**（SQL、Gmail、Ollama 等）

### 6. LLM 集成层

兼容多种 LLM：**OpenAI、IBM Granite、Llama2、Ollama、LangChain** 等。

---

## 典型工作流

```
数据加载 → 分块/节点化 → 创建嵌入向量 → 构建索引 → 存储 → 检索查询 → LLM 响应
```

## 主要用例

- **RAG 问答系统**：基于私有文档的 Q&A
- **聊天机器人**：个性化知识助手
- **结构化数据提取**：从非结构化文本中提取结构化信息
- **自主代理**：复杂多步研究任务
- **Text-to-SQL / Text-to-Pandas**：用自然语言查询数据库

---

> **和 LangChain 的区别**：LlamaIndex **专精于搜索和检索（RAG）**，而 LangChain 是更通用的模块化编排平台，支持更多样化的用例（Agent、Chain、Memory 等）。两者也可以搭配使用。