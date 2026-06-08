# 🦙 LlamaIndex 学习路径（RAG 核心 · TypeScript 版）

专注 RAG 核心链路，剔除无关内容。

---

## 阶段一：RAG 基础闭环（2-3 天）

**目标**：跑通「文档 → 索引 → 检索 → 回答」完整链路

### Hello World

```typescript
import { VectorStoreIndex, SimpleDirectoryReader } from "llamaindex";

// 1. 加载
const documents = await new SimpleDirectoryReader()
  .loadData({ directoryPath: "./data" });

// 2. 索引（自动完成：分块 → Embedding → 存储）
const index = await VectorStoreIndex.fromDocuments(documents);

// 3. 查询
const queryEngine = index.asQueryEngine();
const response = await queryEngine.query({ query: "你的问题" });
console.log(response.toString());
```

### 必须理解的概念

| 概念 | 说明 |
|------|------|
| **向量索引** | 为什么比关键词搜索更准（语义匹配而非字面匹配） |
| **similarity_top_k** | 检索多少片段给模型（太少漏信息，太多干扰） |
| **chunk_size** | 分块大小（太大丢细节，太小缺上下文） |

---

## 阶段二：数据接入与加工（2-3 天）

**目标**：能处理你的各种资料格式

### 不同数据源加载

```typescript
// PDF
import { PDFReader } from "@llamaindex/readers";
const reader = new PDFReader();
const docs = await reader.loadData({ filePath: "./doc.pdf" });

// Markdown（自动保留标题层级）
const documents = await new SimpleDirectoryReader()
  .loadData({ directoryPath: "./data" });

// 网页
// 使用 SimpleWebPageReader（llamaindex 内置）
```

### 文本分块策略

```typescript
import { SentenceSplitter } from "llamaindex";

const splitter = new SentenceSplitter({
  chunkSize: 512,
  chunkOverlap: 50,
});
```

| 文档类型 | 推荐策略 |
|---------|---------|
| 普通文档 | `SentenceSplitter({ chunkSize: 512, chunkOverlap: 50 })` |
| Markdown | 默认加载器按标题切分，保留层级 |

---

## 阶段三：检索质量优化（重点，3-5 天）

**目标**：让系统找到真正相关的内容，这是 RAG 的核心竞争力。

### 1. Retrieval 模式配置

```typescript
// 基础版：top-k 检索
const queryEngine = index.asQueryEngine({
  similarityTopK: 5,
});

// 进阶版：多召回 + 重排序
const queryEngine = index.asQueryEngine({
  similarityTopK: 20,
  // nodePostprocessors: [reranker],  // 需要安装对应的包
});
```

### 2. 元数据过滤（按类别/时间筛选）

```typescript
// 给文档打标签
const doc = { text: "...", metadata: { category: "工作笔记", year: "2024" } };

// 查询时使用 MetadataFilters（llamaindex 内置模块）
```

---

## 阶段四：工程化落地（2-3 天）

**目标**：把 demo 变成可用工具。

### 1. 索引持久化（避免每次重建）

```typescript
import { StorageContext, VectorStoreIndex } from "llamaindex";

// 保存索引
index.storageContext?.persist({ persistDir: "./storage" });

// 加载已有索引
import { fs } from "@llamaindex/env";
// 使用 VectorStoreIndex.init 或从持久化存储加载
```

### 2. 增量更新

```typescript
// 插入新文档，不重建整个索引
const newDocs = await new SimpleDirectoryReader()
  .loadData({ directoryPath: "./data/new" });
for (const doc of newDocs) {
  await index.insert(doc);
}
// 再次持久化
index.storageContext?.persist({ persistDir: "./storage" });
```

---

## 学习路线图（总览）

```
Week 1: 基础闭环
  Day 1-2: 环境搭建 + Hello World
  Day 3-4: 加载不同格式文档，理解分块策略
  Day 5-7: 对比不同 chunkSize 的效果

Week 2: 检索优化（核心）
  Day 8-10: 尝试不同检索配置，对比效果
  Day 11-12: 加入 Rerank，感受质量提升
  Day 13-14: 元数据过滤实践

Week 3: 工程化
  Day 15-17: 持久化 + 增量更新
  Day 18-21: 搭 Web 界面，日常用起来
```

---

## 不需要学的（先跳过）

| 跳过 | 原因 |
|------|------|
| **Agent** | 那是 LangChain 的主场，与 RAG 无关 |
| **多模态（图文混合）** | 除非你的知识库有大量图片 |
| **复杂工作流编排** | 个人知识库用不上 |
| **自定义 LLM** | 先用远程 API，本地模型后续再说 |

---

> **一句话建议**：先花 3 天跑通基础链路，然后重点优化「检索质量」，其他的都是锦上添花。