/**
 * RAG 学习与测试脚本 (FAISS 版本)
 * 
 * 与 Chroma 版本的区别：
 *   - FAISS 是纯计算库，不需要启动 HTTP 服务
 *   - FAISS 数据存储在本地文件中（faiss_index/ 目录）
 *   - FAISS 不支持元数据过滤（Chroma 支持）
 *   - FAISS 更适合小规模、单机部署
 *   - Chroma 更适合开发调试、需要 HTTP API 的场景
 * 
 * 运行方式：
 *   tsx src/Harness/test/3.test-rag-faiss.ts
 * 
 * 前置条件：
 *   1. .env 中配置了 OPENAI_API_KEY（或 Ollama 本地模型）
 *   2. 不需要启动 Chroma 服务！FAISS 是纯本地的
 */

import { Document } from "@langchain/core/documents";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { embeddingService } from "../src/services/embedding.ts";
import { DocumentChunker, DEFAULT_CHUNK_CONFIGS } from "../src/services/rag/chunker.ts";
import { BM25Retriever } from "../src/services/rag/bm25.ts";
import { PromptTemplate } from "@langchain/core/prompts";
import { llmService } from "../src/services/llm.ts";

// ==================== 测试数据 ====================

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
- 纯推理 Agent 只靠 LLM 内部知识，无法获取外部信息
- ReAct Agent 通过 Tool 与外部世界交互，能获取实时数据

ReAct 的优势：
- 可验证：每个 Action 都有明确的输入输出
- 可追溯：思考过程完全透明
- 可扩展：新增 Tool 即可扩展 Agent 的能力`,
    metadata: { source: "react-intro.md", topic: "ReAct", tags: ["react", "agent", "推理"] },
  }),
  new Document({
    pageContent: `FAISS（Facebook AI Similarity Search）是 Meta 开源的高效向量检索库。

FAISS 的核心功能：
- 高效的向量相似度搜索（支持 L2、cosine、inner product）
- 支持十亿级别向量规模
- GPU 加速（可选）
- 纯计算库，无需 HTTP 服务

FAISS vs Chroma：
- FAISS：纯计算库，数据存本地文件，适合嵌入式、单机场景
- Chroma：有 HTTP API 和持久化，适合开发调试、多客户端场景
- FAISS 性能更高（特别是大规模数据）
- Chroma 功能更丰富（元数据过滤、多 collection）

FAISS 使用方式（LangChain 集成）：
1. 创建向量存储：FaissStore.fromDocuments() 或 FaissStore.fromTexts()
2. 检索：similaritySearch() 或 similaritySearchWithScore()
3. 保存到文件：save() 
4. 从文件加载：load()`,
    metadata: { source: "faiss-intro.md", topic: "FAISS", tags: ["faiss", "向量检索", "本地"] },
  }),
];

// ==================== FAISS RAG Pipeline ====================

class FaissRAGPipeline {
  private vectorStore: FaissStore | null = null;
  private chunker: DocumentChunker;
  private bm25Retriever: BM25Retriever;
  private allChunks: Document[] = [];
  private indexPath: string = "./faiss_index";

  constructor() {
    this.chunker = new DocumentChunker(DEFAULT_CHUNK_CONFIGS.text);
    this.bm25Retriever = new BM25Retriever();
  }

  /**
   * 索引文档：文档 → 分块 → Embedding → 存入 FAISS
   */
  async indexDocuments(docs: Document[]): Promise<void> {
    console.log(`[FAISS RAG] Indexing ${docs.length} documents...`);

    // Step 1: 分块
    const chunks = await this.chunker.splitMany(docs);
    console.log(`[FAISS RAG] Chunked into ${chunks.length} pieces`);

    // Step 2: 创建 FAISS 向量存储（自动 Embedding）
    // FAISS 不需要启动服务，直接在内存中创建
    this.vectorStore = await FaissStore.fromDocuments(
      chunks,
      embeddingService.getEmbeddings(),
    );
    console.log(`[FAISS RAG] Created FAISS store with ${chunks.length} vectors`);

    // Step 3: 加载到关键词检索器
    this.allChunks.push(...chunks);
    this.bm25Retriever.loadDocuments(this.allChunks);
    console.log(`[FAISS RAG] Loaded into keyword retriever`);
  }

  /**
   * 向量检索
   */
  async vectorSearch(query: string, topK: number = 5): Promise<Document[]> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized. Call indexDocuments first.");
    }
    return await this.vectorStore.similaritySearch(query, topK);
  }

  /**
   * 带分数的向量检索
   */
  async vectorSearchWithScore(query: string, topK: number = 5): Promise<[Document, number][]> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized. Call indexDocuments first.");
    }
    return await this.vectorStore.similaritySearchWithScore(query, topK);
  }

  /**
   * 混合检索：向量 + BM25关键词
   */
  async hybridSearch(query: string, topK: number = 5, vectorWeight: number = 0.7, keywordWeight: number = 0.3): Promise<HybridResult[]> {
    // 向量检索
    const vectorResults = await this.vectorSearchWithScore(query, topK);
    
    // BM25关键词检索
    const keywordResults = this.bm25Retriever.search(query, topK);

    // 合并并计算混合分数
    const results: Map<string, HybridResult> = new Map();

    // 处理向量检索结果（FAISS 返回的是 L2 距离，需要转换为相似度）
    vectorResults.forEach(([doc, distance]) => {
      const key = doc.pageContent;
      // L2 distance → similarity: 1/(1+distance)
      const similarity = 1 / (1 + distance);
      results.set(key, {
        document: doc,
        vectorScore: similarity,
        keywordScore: 0,
        finalScore: similarity * vectorWeight,
        source: "vector",
      });
    });

    // 处理关键词检索结果
    keywordResults.forEach(r => {
      const key = r.doc.pageContent;
      if (results.has(key)) {
        // 已有向量结果，合并分数
        const existing = results.get(key)!;
        existing.keywordScore = r.score;
        existing.finalScore = existing.vectorScore * vectorWeight + r.score * keywordWeight;
        existing.source = "hybrid";
      } else {
        // 只有关键词结果
        results.set(key, {
          document: r.doc,
          vectorScore: 0,
          keywordScore: r.score,
          finalScore: r.score * keywordWeight,
          source: "keyword",
        });
      }
    });

    // 按混合分数排序
    return Array.from(results.values())
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, topK);
  }

  /**
   * 完整 RAG 查询：检索 + LLM 生成
   */
  async query(query: string): Promise<string> {
    console.log(`[FAISS RAG] Querying: "${query}"`);

    // Step 1: 混合检索
    const results = await this.hybridSearch(query);

    if (results.length === 0) {
      return "根据现有文档，无法找到相关信息来回答这个问题。";
    }

    // Step 2: 拼接 context
    const context = results
      .map((r, i) => {
        const source = r.document.metadata?.source || "unknown";
        return `[文档${i + 1}] (来源: ${source}, 相关度: ${r.finalScore.toFixed(3)})\n${r.document.pageContent}`;
      })
      .join("\n\n");

    console.log(`[FAISS RAG] Retrieved ${results.length} documents, context length: ${context.length}`);

    // Step 3: 构造 Prompt 并生成
    const prompt = await PromptTemplate.fromTemplate(RAG_PROMPT_TEMPLATE).format({
      context,
      question: query,
    });

    const answer = await llmService.chat([
      { role: "system", content: prompt },
    ]);

    return answer;
  }

  /**
   * 保存 FAISS 索引到文件（下次可以直接加载，不需要重新 Embedding）
   */
  async save(): Promise<void> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized.");
    }
    await this.vectorStore.save(this.indexPath);
    console.log(`[FAISS RAG] Saved index to ${this.indexPath}`);
  }

  /**
   * 从文件加载 FAISS 索引（跳过 Embedding 步骤，直接检索）
   */
  async load(): Promise<void> {
    this.vectorStore = await FaissStore.load(
      this.indexPath,
      embeddingService.getEmbeddings(),
    );
    console.log(`[FAISS RAG] Loaded index from ${this.indexPath}`);
  }
}

interface HybridResult {
  document: Document;
  vectorScore: number;
  keywordScore: number;
  finalScore: number;
  source: string;
}

const RAG_PROMPT_TEMPLATE = `你是一个知识助手。请仅基于以下检索到的文档内容来回答用户的问题。
如果文档中没有相关信息，请明确说明"根据现有文档，无法回答这个问题"，不要编造内容。

检索到的文档：
{context}

用户问题：{question}

请基于上述文档内容给出准确、有据可依的回答：`;

// ==================== Step-by-step 测试 ====================

async function main() {
  console.log("=== RAG 学习与测试 (FAISS 版本) ===\n");
  console.log("与 Chroma 版本的关键区别：");
  console.log("  ✅ 不需要启动 HTTP 服务");
  console.log("  ✅ 数据存储在本地文件");
  console.log("  ✅ 纯内存计算，速度快");
  console.log("  ⚠️ 不支持元数据过滤");
  console.log("  ⚠️ 不支持多 Collection\n");

  // ---- Step 1: Embedding ----
  console.log("📚 Step 1: Embedding — 文本如何变成向量");
  console.log("-------------------------------------------");

  try {
    const text = "什么是 RAG？";
    console.log(`输入文本: "${text}"`);

    const vector = await Promise.race([
      embeddingService.embedQuery(text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Embedding 调用超时（30s）")), 30000)
      ),
    ]);
    console.log(`向量维度: ${vector.length}`);
    console.log(`向量前5个值: [${vector.slice(0, 5).map((v) => v.toFixed(4)).join(", ")}]`);
  } catch (error: any) {
    console.log(`⚠️ Embedding 测试失败: ${error.message}`);
    console.log("请检查 .env 中的 API Key 配置");
    return;
  }

  console.log("\n");

  // ---- Step 2: Chunking ----
  console.log("📚 Step 2: Chunking — 文档如何被分块");
  console.log("-------------------------------------------");

  const longDoc = new Document({
    pageContent: `# RAG 系统设计\n\n## 概述\nRAG 是检索增强生成技术。它结合了信息检索与文本生成，让 LLM 能够基于外部知识回答问题。\n\n## 核心组件\n### Embedding\nEmbedding 将文本转为向量，使得语义相似的文本在向量空间中距离更近。\n\n### 向量数据库\nFAISS 是高效的向量检索库，适合本地部署。Chroma 是轻量级向量数据库，适合开发调试。\n\n### 分块器\n分块器将长文档切分为小块，每块独立 Embedding，提高检索精度。\n\n## 检索策略\n混合检索 = 向量检索(0.7) + 关键词检索(0.3)`,
    metadata: { source: "rag-design.md" },
  });

  const chunker = new DocumentChunker(DEFAULT_CHUNK_CONFIGS.text);
  const chunks = await chunker.split(longDoc);
  console.log(`递归字符拆分: ${chunks.length} 块`);
  chunks.forEach((chunk, i) => {
    console.log(`  块${i + 1}: ${chunk.pageContent.length} 字符`);
  });

  console.log("\n");

  // ---- Step 3: Indexing (FAISS 不需要启动服务!) ----
  console.log("📚 Step 3: Indexing — 文档存入 FAISS 向量库");
  console.log("-------------------------------------------");
  console.log("✅ FAISS 不需要启动服务！直接在内存中创建");
  console.log("");

  const rag = new FaissRAGPipeline();
  await rag.indexDocuments(SAMPLE_DOCUMENTS);
  console.log("");

  // ---- Step 4: Retrieval ----
  console.log("📚 Step 4: Retrieval — 检索相关文档");
  console.log("-------------------------------------------");

  // 纯向量检索
  console.log("\n--- 纯向量检索 ---");
  const vectorResults = await rag.vectorSearchWithScore("检索增强生成", 3);
  vectorResults.forEach(([doc, score]) => {
    console.log(`  内容: ${doc.pageContent.slice(0, 60)}...`);
    console.log(`  L2距离: ${score.toFixed(4)}, 相似度: ${(1/(1+score)).toFixed(4)}`);
    console.log(`  来源: ${doc.metadata?.source}`);
  });

  // 混合检索
  console.log("\n--- 混合检索（向量 + BM25） ---");
  const hybridResults = await rag.hybridSearch("检索增强生成", 3);
  hybridResults.forEach(r => {
    console.log(`  内容: ${r.document.pageContent.slice(0, 60)}...`);
    console.log(`  混合分数: ${r.finalScore.toFixed(4)} (向量: ${r.vectorScore.toFixed(4)}, 关键词: ${r.keywordScore.toFixed(4)})`);
    console.log(`  来源: ${r.source}`);
  });

  console.log("\n");

  // ---- Step 5: Generation ----
  console.log("📚 Step 5: Generation — LLM 基于检索结果生成回答");
  console.log("-------------------------------------------");

  const answer = await rag.query("什么是 RAG？它解决了什么问题？");
  console.log("回答:", answer);

  // ---- 保存索引（下次可直接加载） ----
  console.log("\n📚 保存 FAISS 索引到文件");
  console.log("-------------------------------------------");
  await rag.save();
  console.log("保存成功！下次可以直接加载，跳过 Embedding 步骤\n");

  // ---- Step 6: Load 场景验证 ----
  console.log("\n📚 Step 6: Load — 从文件加载索引，跳过 Embedding 步骤");
  console.log("-------------------------------------------");

  // 创建一个新的 Pipeline 实例（不调用 indexDocuments）
  const rag2 = new FaissRAGPipeline();
  await rag2.load(); // 直接从文件加载，跳过 Embedding

  // 验证：直接检索（不需要重新索引）
  console.log("验证：直接检索（跳过了 Embedding 步骤）");
  const loadResults = await rag2.vectorSearchWithScore("什么是 FAISS", 2);
  loadResults.forEach(([doc, score]) => {
    console.log(`  内容: ${doc.pageContent.slice(0, 60)}...`);
    console.log(`  L2距离: ${score.toFixed(4)}, 相似度: ${(1/(1+score)).toFixed(4)}`);
  });

  // 验证：直接生成回答
  const loadAnswer = await rag2.query("FAISS 和 Chroma 有什么区别？");
  console.log("回答:", loadAnswer);

  console.log("\n");

  // 对比 save/load 的性能优势
  console.log("💡 save/load 的实际意义：");
  console.log("  - 首次运行：indexDocuments → Embedding（慢，需要 API 调用）→ save");
  console.log("  - 后续运行：load（快，直接从文件读取）→ 检索/生成");
  console.log("  - 适合场景：知识库不常更新，但频繁查询");

  console.log("\n=== RAG 学习总结 (FAISS vs Chroma) ===");
  console.log(`
  FAISS 版本优势：
  ┌──────────────────────────────────────────────────────────┐
  │  ✅ 不需要启动 HTTP 服务（Chroma 需要 chroma run）        │
  │  ✅ 纯本地文件存储（Chroma 需要 HTTP 连接）               │
  │  ✅ 性能更高（特别是大规模数据时）                        │
  │  ✅ 可以 save/load 索引，跳过重复 Embedding              │
  │  ⚠️ 不支持元数据过滤（Chroma 支持 where 条件）          │
  │  ⚠️ 不支持多 Collection（Chroma 支持）                   │
  └──────────────────────────────────────────────────────────┘

  选择建议：
  - 开发调试 → 用 Chroma（功能丰富、HTTP API 方便观察）
  - 生产部署 → 用 FAISS（性能好、无需额外服务）
  - 个人项目 → 用 FAISS（简单、不依赖外部服务）
  `);
}

// 运行
main().catch(console.error);