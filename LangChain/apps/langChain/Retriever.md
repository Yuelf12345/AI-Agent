## 核心定义

**Retriever** 是一个简单的接口：接收查询字符串，返回相关文档列表。它是对检索逻辑的封装，屏蔽了底层实现细节。

```typescript
interface Retriever {
  invoke(query: string): Promise<Document[]>;
}
```

## Vector Store vs Retriever

| 概念 | 职责 |
|------|------|
| **Vector Store** | 存储向量 + 提供搜索方法（增删改查） |
| **Retriever** | 仅负责检索，是 Vector Store 的只读视图 |

任何 Vector Store 都可以转换为 Retriever：

```typescript
const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);

// 转换为 Retriever
const retriever = vectorStore.asRetriever();

// 使用
const docs = await retriever.invoke("查询内容");
```

## 为什么需要 Retriever？

1. **统一接口** — 不同数据源（向量库、全文搜索、混合检索）暴露相同 API
2. **可组合性** — 可链式组合多个检索器（Ensemble、Reranking）
3. **LangChain 集成** — 与 Chain、Agent 无缝配合

## 常见 Retriever 类型

| 类型 | 用途 |
|------|------|
| `VectorStoreRetriever` | 基于向量相似度检索 |
| `MultiQueryRetriever` | 生成多个查询变体，提高召回率 |
| `ContextualCompressionRetriever` | 压缩检索结果，过滤无关内容 |
| `EnsembleRetriever` | 组合多个检索器 |
| `SelfQueryRetriever` | 用 LLM 解析查询条件（如过滤元数据） |

## 实际应用

```typescript
import { createRetrievalChain } from "langchain/chains/retrieval";

// Retriever 直接用于 RAG 链
const chain = createRetrievalChain({
  retriever,
  combineDocsChain: combineDocsChain,
});
```

**总结**：Retriever 是检索层的抽象，Vector Store 是存储层的实现。Retriever 让检索逻辑可替换、可组合、可测试。