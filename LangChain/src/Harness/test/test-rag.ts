/**
 * RAG 学习与测试脚本
 * 
 * 这个脚本演示了 RAG 的完整流程，按步骤展示每个核心概念：
 *   Step 1: Embedding — 文本如何变成向量
 *   Step 2: Chunking — 文档如何被分块
 *   Step 3: Indexing — 文档如何被存入向量库
 *   Step 4: Retrieval — 如何检索相关文档
 *   Step 5: Generation — 如何让 LLM 基于检索结果生成回答
 * 
 * 运行方式：
 *   tsx src/Harness/test/test-rag.ts
 * 
 * 前置条件：
 *   1. Chroma 服务已启动: chroma run --host localhost --port 8000
 *   2. .env 中配置了 OPENAI_API_KEY（或 Ollama 本地模型）
 */

import { Document } from "@langchain/core/documents";
import { embeddingService } from "../src/services/embedding.ts";
import { DocumentChunker, DEFAULT_CHUNK_CONFIGS } from "../src/services/rag/chunker.ts";
import { RAGPipeline } from "../src/services/rag/pipeline.ts";

// ==================== 测试数据 ====================

/**
 * 模拟知识库文档
 * 
 * 这些文档涵盖不同主题，用于演示 RAG 的检索能力：
 *   - 文档1: RAG 概念介绍
 *   - 文档2: Embedding 概念介绍
 *   - 文档3: LangChain 框架介绍
 *   - 文档4: ReAct 模式介绍
 *   - 文档5: Chroma 向量数据库介绍
 */
const SAMPLE_DOCUMENTS: Document[] = [
  new Document({
    pageContent: `RAG（检索增强生成，Retrieval-Augmented Generation）是一种结合信息检索与文本生成的技术架构。

核心思想是在 LLM 生成回答之前，先从外部知识库中检索相关信息，然后将检索结果作为上下文提供给 LLM。

RAG 解决了 LLM 的三大问题：
1. 知识时效性：LLM 的训练数据有截止日期，RAG 可以检索最新信息
2. 私有数据访问：LLM 无法访问用户的私有文档，RAG 可以检索本地知识库
3. 幻觉问题：LLM 可能编造不存在的事实，RAG 让 LLM 基于真实文档回答

RAG 的两个阶段：
- 索引阶段（离线）：文档 → 分块 → Embedding → 向量数据库
- 查询阶段（在线）：提问 → Embedding → 向量检索 → Prompt 构造 → LLM 生成`,
    metadata: { source: "rag-intro.md", topic: "RAG", tags: ["rag", "概念", "架构"] },
  }),
  new Document({
    pageContent: `Embedding（嵌入）是将文本转换为数值向量的技术。

每个文本片段（一句话、一段文字）经过 Embedding 模型处理后，变成一个固定维度的浮点数数组（向量）。

例如：
  "什么是 RAG" → [0.12, -0.34, 0.56, ..., 0.78]  (768维或1536维)

Embedding 的关键特性：
- 语义相似的文本 → 向量距离近（cosine similarity 高）
- 语义不同的文本 → 向量距离远
- 这种特性使得"语义检索"成为可能

常用 Embedding 模型：
- nomic-embed-text（Ollama 本地，768维）
- text-embedding-3-small（OpenAI，1536维）
- BGE 系列（开源，多种维度）`,
    metadata: { source: "embedding-intro.md", topic: "Embedding", tags: ["embedding", "向量", "模型"] },
  }),
  new Document({
    pageContent: `LangChain 是一个流行的 AI 应用开发框架，提供了构建 LLM 应用的工具链。

LangChain 的核心模块：
- Model I/O：与 LLM 的交互接口（ChatModel、LLM、Embeddings）
- Retrieval：文档加载、分块、向量检索
- Chains：将多个组件串联成处理链
- Agents：让 LLM 自主选择工具和行动（ReAct）
- Memory：对话历史和长期记忆管理

LangChain.js 是 LangChain 的 TypeScript/JavaScript 版本，
适合 Node.js 后端和全栈开发，支持 OpenAI、Ollama 等多种 LLM 提供者。

本项目使用 LangChain.js 构建 Harness 框架。`,
    metadata: { source: "langchain-intro.md", topic: "LangChain", tags: ["langchain", "框架", "工具链"] },
  }),
  new Document({
    pageContent: `ReAct（Reasoning + Acting）是一种让 AI Agent 先思考再行动的模式。

ReAct 循环：
1. Thought（思考）：LLM 分析当前情况，决定下一步做什么
2. Action（行动）：调用一个 Tool 执行具体操作（如搜索、读取文件）
3. Observation（观察）：获取 Tool 的返回结果
4. 重复上述步骤，直到得出最终答案

ReAct vs 纯推理：
- 纔推理 Agent 只靠 LLM 内部知识，无法获取外部信息
- ReAct Agent 通过 Tool 与外部世界交互，能获取实时数据

ReAct 的优势：
- 可验证：每个 Action 都有明确的输入输出
- 可追溯：思考过程完全透明
- 可扩展：新增 Tool 即可扩展 Agent 的能力`,
    metadata: { source: "react-intro.md", topic: "ReAct", tags: ["react", "agent", "推理"] },
  }),
  new Document({
    pageContent: `Chroma 是一个开源的向量数据库，专为 AI 应用设计。

Chroma 的核心功能：
- 存储文档及其 Embedding 向量
- 支持相似度搜索（cosine similarity、L2 distance）
- 支持元数据过滤（按 tags、source 等条件筛选）
- 轻量级、本地运行、无需复杂配置

Chroma 使用方式：
1. 启动服务：chroma run --host localhost --port 8000
2. 创建 Collection：类似数据库的"表"，存储一类文档
3. 添加文档：addDocuments() 自动 Embedding + 存储
4. 查询：query() 通过向量相似度检索

Chroma vs 其他向量库：
- vs Pinecone：Chroma 本地免费，Pinecone 云端收费
- vs FAISS：Chroma 有 HTTP API 和持久化，FAISS 是纯计算库
- vs Milvus：Chroma 更轻量，Milvus 适合大规模生产`,
    metadata: { source: "chroma-intro.md", topic: "Chroma", tags: ["chroma", "向量数据库", "检索"] },
  }),
];

// ==================== Step-by-step 测试 ====================

async function main() {
  console.log("=== RAG 学习与测试 ===\n");

  // ---- Step 1: Embedding ----
  console.log("📚 Step 1: Embedding — 文本如何变成向量");
  console.log("-------------------------------------------");

  try {
    const text = "什么是 RAG？";
    console.log(`输入文本: "${text}"`);
    console.log("正在调用 Embedding API...（如超时请检查 .env 配置）");

    const vector = await Promise.race([
      embeddingService.embedQuery(text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Embedding 调用超时（30s），请检查 API 配置")), 30000)
      ),
    ]);
    console.log(`向量维度: ${vector.length}`);
    console.log(`向量前5个值: [${vector.slice(0, 50).map((v) => v.toFixed(4)).join(", ")}]`);
    console.log(`向量范数: ${Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)).toFixed(4)}`);

    // 计算两段文本的相似度
    const vec1 = await embeddingService.embedQuery("检索增强生成");
    const vec2 = await embeddingService.embedQuery("足球比赛规则");
    const similarity = cosineSimilarity(vec1, vec2);
    console.log(`\n语义相似度测试:`);
    console.log(`  "检索增强生成" vs "足球比赛规则": ${similarity.toFixed(4)} (应该很低)`);
  } catch (error: any) {
    console.log(`⚠️ Embedding 测试失败（可能未配置 API Key）: ${error.message}`);
  }

  console.log("\n");

  // ---- Step 2: Chunking ----
  console.log("📚 Step 2: Chunking — 文档如何被分块");
  console.log("-------------------------------------------");

  const longDoc = new Document({
    pageContent: `# RAG 系统设计\n\n## 概述\nRAG 是检索增强生成技术。它结合了信息检索与文本生成，让 LLM 能够基于外部知识回答问题。\n\n## 核心组件\n### Embedding\nEmbedding 将文本转为向量，使得语义相似的文本在向量空间中距离更近。\n\n### 向量数据库\nChroma 是轻量级向量数据库，支持相似度搜索和元数据过滤。\n\n### 分块器\n分块器将长文档切分为小块，每块独立 Embedding，提高检索精度。\n\n## 检索策略\n混合检索 = 向量检索(0.7) + 关键词检索(0.3)\n\n向量检索擅长语义相似匹配，关键词检索擅长精确字面匹配。两者互补。`,
    metadata: { source: "rag-design.md" },
  });

  // 递归字符拆分
  const recursiveChunker = new DocumentChunker(DEFAULT_CHUNK_CONFIGS.text);
  const recursiveChunks = await recursiveChunker.split(longDoc);
  console.log(`递归字符拆分: ${recursiveChunks.length} 块`);
  recursiveChunks.forEach((chunk, i) => {
    console.log(`  块${i + 1}: ${chunk.pageContent.length} 字符, metadata: ${JSON.stringify(chunk.metadata)}`);
  });

  console.log("\n");

  // ---- Step 3: Indexing (需要 Chroma 服务) ----
  console.log("📚 Step 3: Indexing — 文档存入向量库");
  console.log("-------------------------------------------");
  console.log("⚠️ 此步骤需要 Chroma 服务运行中 (chroma run --host localhost --port 8000)");
  console.log("\n");
  const rag = new RAGPipeline();
  await rag.reset();  // 先删除 collection 再重新索引
  await rag.initialize();
  await rag.indexDocuments(SAMPLE_DOCUMENTS);
  console.log("索引完成，文档数量:", await rag.getDocumentCount());

  // ---- Step 4: Retrieval ----
  console.log("📚 Step 4: Retrieval — 如何检索相关文档");
  console.log("-------------------------------------------");
  console.log("⚠️ 此步骤需要向量库中有数据（先完成 Step 3）");
  console.log("\n");
  // // 纯向量检索
  // console.log("--- 纯向量检索 ---");
  // const vectorResults = await rag.retrieve("什么是 RAG", "vector");
  // vectorResults.forEach(r => {
  //   console.log(r.document.pageContent.slice(0, 50), "score:", r.finalScore, "source:", r.source);
  // });

  // // 纯关键词检索
  // console.log("\n--- 纯关键词检索 ---");
  // const keywordResults = await rag.retrieve("LangChain", "keyword");
  // keywordResults.forEach(r => {
  //   console.log(r.document.pageContent.slice(0, 50), "score:", r.finalScore, "source:", r.source);
  // });

  // // 混合检索（推荐）
  // console.log("\n--- 混合检索（推荐） ---");
  // const hybridResults = await rag.retrieve("检索增强生成", "hybrid");
  // hybridResults.forEach(r => {
  //   console.log(r.document.pageContent.slice(0, 50), "score:", r.finalScore, "source:", r.source);
  // });
  // ---- Step 5: Generation ----
  console.log("📚 Step 5: Generation — LLM 基于检索结果生成回答");
  console.log("-------------------------------------------");
  console.log("⚠️ 此步骤需要 LLM 和向量库均可用");  
  const answer = await rag.query("什么是 RAG？它解决了什么问题？");
  // const answer = await rag.query("什么是skill?");

  console.log("回答:", answer);
  console.log("\n=== RAG 学习总结 ===");
  console.log(`
  RAG 五步流程：
  ┌───────────┐   ┌──────────┐   ┌───────────┐   ┌───────────┐   ┌──────────┐
  │ Embedding │──▶│ Chunking │──▶│ Indexing  │──▶│ Retrieval │──▶│Generation│
  │ 文本→向量  │   │ 文档→小块  │   │ 存入向量库 │   │ 检索相关文档 │   │ LLM 生成 │
  └───────────┘   └──────────┘   └───────────┘   └───────────┘   └──────────┘
  
  关键文件：
  - embedding.ts    → Step 1
  - rag/chunker.ts  → Step 2
  - vector.ts       → Step 3
  - rag/retriever.ts → Step 4
  - rag/pipeline.ts  → Step 5 (串联所有步骤)
  
  混合检索权重：向量检索 0.7 + 关键词检索 0.3
  `);
}

// ==================== 工具函数 ====================

/**
 * 计算余弦相似度
 * 
 * cosine similarity = dot(a, b) / (norm(a) * norm(b))
 * 
 * 值域 [-1, 1]：
 *   1 = 完全相同方向（语义最相似）
 *   0 = 无关
 *   -1 = 完全相反方向
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (normA * normB);
}

// 运行
main().catch(console.error);