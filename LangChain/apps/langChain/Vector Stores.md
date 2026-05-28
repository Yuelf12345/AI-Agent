## 核心概念

**Vector Store** 将文本转换为向量后存储，支持基于语义相似度的检索。相比关键词搜索，它能找到"意思相近"的内容，而非仅仅"字面匹配"的内容。

## 工作流程

```
文本 → Embedding模型 → 向量 → Vector Store
                                    ↓
查询 → Embedding模型 → 向量 → 相似度搜索 → 返回相关文档
```

## 主要用途

- **RAG（检索增强生成）**：从知识库检索相关片段给 LLM
- **语义搜索**：根据含义而非关键词搜索
- **推荐系统**：找到相似内容

## 常见实现

| 类型 | 示例 |
|------|------|
| 内存 | `MemoryVectorStore` |
| 本地数据库 | `Chroma`, `FAISS`, `LanceDB` |
| 云服务 | `Pinecone`, `Weaviate`, `Milvus` |

## 简单示例

```typescript
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";

// 创建向量存储
const vectorStore = await MemoryVectorStore.fromDocuments(
  documents,
  new OpenAIEmbeddings()
);

// 相似度搜索
const results = await vectorStore.similaritySearch("查询内容", 4);
```

Vector Store 是构建 RAG 应用的基础设施，决定了检索质量和系统性能。