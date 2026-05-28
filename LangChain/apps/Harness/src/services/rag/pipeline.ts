/**
 * RAG Pipeline - 端到端检索增强生成
 * 
 * 负责：将 Embedding、Chunking、Retrieval、Generation 串联成完整的 RAG 流程
 * 
 * RAG 核心概念：
 *   RAG = Retrieval-Augmented Generation（检索增强生成）
 *   
 *   传统 LLM 只靠自身知识生成回答，存在三大问题：
 *   1. 知识有限（训练数据截止日期后的事不知道）
 *   2. 无法访问私有数据（你的笔记、文档）
 *   3. 可能"幻觉"（编造不存在的事实）
 *   
 *   RAG 的解决思路：
 *   用户提问 → 先从文档库检索相关内容 → 将检索结果作为上下文喂给 LLM → LLM 基于事实生成回答
 *   
 *   完整流程：
 *   ┌──────────┐    ┌──────────┐   ┌──────────┐    ┌──────────┐   ┌──────────┐
 *   │  用户提问  │──▶│  检索文档  │──▶│构造 Prompt│──▶│  LLM 生成 │──▶│  回答用户  │
 *   └──────────┘    └──────────┘   └──────────┘    └──────────┘   └──────────┘
 *                      ↑
 *               ┌──────────┐
 *               │ 向量数据库 │
 *               └──────────┘
 *   
 *   两个阶段：
 *   1. 索引阶段（离线）：文档 → 分块 → Embedding → 存入向量库
 *   2. 查询阶段（在线）：query → Embedding → 检索 → 构造 Prompt → LLM 生成
 */

import { Document } from "@langchain/core/documents";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { VectorStoreService } from "../vector.ts";
import { DocumentChunker } from "./chunker.ts";
import { RAGRetriever, type EnrichedRetrievalResult } from "./retriever.ts";
import { BM25Retriever } from "./bm25.ts";
import { Reranker, type RerankStrategy } from "./reranker.ts";
import { embeddingService } from "../embedding.ts";
import { llmService } from "../llm.ts";
import { config } from "../../config/index.ts";

/**
 * RAG Prompt 模板
 * 
 * 关键设计：
 *   - 明确告知 LLM "只基于以下文档回答"（减少幻觉）
 *   - 提供检索到的文档作为事实依据
 *   - 要求 LLM 在不知道时明确说"文档中没有相关信息"
 */
export const RAG_PROMPT_TEMPLATE = `你是一个知识助手。请仅基于以下检索到的文档内容来回答用户的问题。
如果文档中没有相关信息，请明确说明"根据现有文档，无法回答这个问题"，不要编造内容。

检索到的文档：
{context}

用户问题：{question}

请基于上述文档内容给出准确、有据可依的回答：`;

/**
 * RAG Pipeline 配置
 */
export interface RAGConfig {
  chunkStrategy: "recursive" | "markdown" | "code";
  chunkSize: number;
  chunkOverlap: number;
  retrievalTopK: number;
  retrievalThreshold: number;
  vectorWeight: number;    // 混合检索中向量检索的权重
  keywordWeight: number;  // 混合检索中关键词检索的权重
  useBM25: boolean;        // 是否使用 BM25 替代简易 TF
  rerankStrategy: RerankStrategy | null;  // 重排序策略，null 表示不使用
}

/**
 * 默认 RAG 配置
 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  chunkStrategy: "recursive",
  chunkSize: 1000,
  chunkOverlap: 200,
  retrievalTopK: config.memory.longTermMemory.topK,
  retrievalThreshold: config.memory.longTermMemory.threshold,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  useBM25: false,
  rerankStrategy: null,
};

/**
 * RAG Pipeline
 * 
 * 端到端使用方式：
 * 
 *   // 1. 创建 Pipeline
 *   const rag = new RAGPipeline();
 *   
 *   // 2. 索引阶段：加载文档到向量库
 *   await rag.indexDocuments([
 *     new Document({ pageContent: "RAG 是检索增强生成...", metadata: { source: "wiki" } }),
 *     new Document({ pageContent: "Embedding 将文本转为向量...", metadata: { source: "note" } }),
 *   ]);
 *   
 *   // 3. 查询阶段：提问并获取回答
 *   const answer = await rag.query("什么是 RAG？");
 *   console.log(answer);
 * 
 *   // 也可以只检索不生成（获取相关文档片段）
 *   const results = await rag.retrieve("什么是 RAG？");
 *   results.forEach(r => console.log(r.document.pageContent, r.finalScore));
 */
export class RAGPipeline {
  private config: RAGConfig;
  private vectorService: VectorStoreService;
  private chunker: DocumentChunker;
  private retriever: RAGRetriever;
  private bm25Retriever: BM25Retriever;
  private reranker: Reranker | null;
  private allChunks: Document[] = []; // 缓存所有分块（用于关键词检索）
  private initialized: boolean = false;

  constructor(ragConfig?: Partial<RAGConfig>) {
    this.config = { ...DEFAULT_RAG_CONFIG, ...ragConfig };

    // 组装各组件
    this.vectorService = new VectorStoreService();
    this.chunker = new DocumentChunker({
      strategy: this.config.chunkStrategy,
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
    });
    this.retriever = new RAGRetriever(this.vectorService, {
      vectorWeight: this.config.vectorWeight,
      keywordWeight: this.config.keywordWeight,
    });
    this.bm25Retriever = new BM25Retriever();
    this.reranker = this.config.rerankStrategy
      ? new Reranker({ strategy: this.config.rerankStrategy })
      : null;
  }

  // ==================== 索引阶段 ====================

  /**
   * 初始化 Pipeline（连接 Chroma 等）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorService.initialize();
    this.initialized = true;
    console.log("[RAG] Pipeline initialized");
  }

  /**
   * 重置 Pipeline：删除 collection 并重新初始化
   */
  async reset(): Promise<void> {
    await this.vectorService.reset();
    this.initialized = false;
    console.log("[RAG] Pipeline reset, collection deleted");
  }

  /**
   * 索引文档：文档 → 分块 → Embedding → 存入向量库
   * 
   * 这是 RAG 的"离线准备"阶段，将你的知识库建立索引：
   *   1. 长文档被切分为小块（Chunker）
   *   2. 每个小块被转为向量（Embedding）
   *   3. 向量存入 Chroma（VectorStore）
   *   4. 原始文本也加载到关键词检索器
   * 
   * @param docs 要索引的文档列表
   */
  async indexDocuments(docs: Document[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`[RAG] Indexing ${docs.length} documents...`);

    // Step 1: 分块
    const chunks = await this.chunker.splitMany(docs);
    console.log(`Step 1: 分块 [RAG] Chunked into ${chunks.length} pieces`);

    // Step 2: Embedding + 存入向量库（addDocuments 自动完成这两步）
    await this.vectorService.addDocuments(chunks);
    console.log(`Step 2: Embedding + 存入向量库 [RAG] Embedded and stored in Chroma`);

    // Step 3: 同时加载到关键词检索器
    this.allChunks.push(...chunks);
    this.retriever.setKeywordDocuments(this.allChunks);
    console.log(`Step 3: 同时加载到关键词检索器 [RAG] Loaded into keyword retriever`);

    // Step 4: 加载到 BM25 检索器
    this.bm25Retriever.loadDocuments(this.allChunks);
    console.log(`Step 4: BM25 [RAG] Loaded into BM25 retriever`);
  }

  /**
   * 从文件索引文档
   * 
   * 读取本地文件 → 创建 Document → 分块 → 索引
   * 
   * @param filePaths 文件路径列表
   */
  async indexFiles(filePaths: string[]): Promise<void> {
    const fs = await import("fs/promises");

    const docs: Document[] = [];
    for (const filePath of filePaths) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        docs.push(
          new Document({
            pageContent: content,
            metadata: {
              source: filePath,
              indexed_at: new Date().toISOString(),
            },
          }),
        );
      } catch (error: any) {
        console.error(`[RAG] Failed to read ${filePath}: ${error.message}`);
      }
    }

    if (docs.length > 0) {
      await this.indexDocuments(docs);
    }
  }

  // ==================== 查询阶段 ====================

  /**
   * 检索相关文档（支持多种模式 + BM25 + Rerank）
   * 
   * @param query 查询文本
   * @param mode 检索模式：vector、keyword、hybrid、bm25
   * @param topK 返回数量
   */
  async retrieve(query: string, mode: "vector" | "keyword" | "hybrid" | "bm25" = "hybrid", topK?: number): Promise<EnrichedRetrievalResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    let results: EnrichedRetrievalResult[];

    switch (mode) {
      case "vector":
        results = await this.retriever.vectorSearch(query, topK);
        break;
      case "keyword":
        results = this.retriever.keywordSearch(query, topK);
        break;
      case "hybrid":
        results = await this.retriever.hybridSearch(query, topK);
        break;
      case "bm25":
        const bm25Results = this.bm25Retriever.search(query, topK || this.config.retrievalTopK);
        results = bm25Results.map(r => ({
          document: r.doc,
          score: r.score,
          metadata: r.doc.metadata as Record<string, unknown>,
          source: "keyword",
          finalScore: r.score * this.config.keywordWeight,
        }));
        break;
    }

    // 如果配置了 Reranker，对结果重排序
    if (this.reranker && results.length > 0) {
      results = await this.reranker.rerank(query, results);
      console.log(`[RAG] Reranked results (strategy: ${this.reranker.getConfig().strategy})`);
    }

    return results;
  }

  /**
   * 完整 RAG 查询：检索 + 生成
   * 
   * 执行完整的 RAG 流程：
   *   1. 检索相关文档（hybridSearch）
   *   2. 将文档拼接为 context
   *   3. 用 PromptTemplate 构造 prompt
   *   4. LLM 生成回答
   * 
   * @param query 用户问题
   * @returns LLM 生成的回答
   */
  async query(query: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Step 1: 检索
    console.log(`[RAG] Retrieving for: "${query}"`);
    const results = await this.retrieve(query);

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

    console.log(`[RAG] Retrieved ${results.length} documents, context length: ${context.length}`);

    // Step 3: 构造 Prompt
    const prompt = await PromptTemplate.fromTemplate(RAG_PROMPT_TEMPLATE).format({
      context,
      question: query,
    });

    // Step 4: LLM 生成
    console.log(`[RAG] Generating answer...`);
    const answer = await llmService.chat([
      { role: "system", content: prompt },
    ]);

    return answer;
  }

  /**
   * 流式 RAG 查询（返回生成过程）
   * 
   * @param query 用户问题
   * @yields 生成过程的文本片段
   */
  async *streamQuery(query: string): AsyncGenerator<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 检索
    const results = await this.retrieve(query);

    if (results.length === 0) {
      yield "根据现有文档，无法找到相关信息来回答这个问题。";
      return;
    }

    const context = results
      .map((r, i) => `[文档${i + 1}] (相关度: ${r.finalScore.toFixed(3)})\n${r.document.pageContent}`)
      .join("\n\n");

    const prompt = await PromptTemplate.fromTemplate(RAG_PROMPT_TEMPLATE).format({
      context,
      question: query,
    });

    // 流式生成
    for await (const chunk of llmService.streamChat([
      { role: "system", content: prompt },
    ])) {
      yield chunk;
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 获取向量库文档数量
   */
  async getDocumentCount(): Promise<number> {
    return await this.vectorService.count();
  }

  /**
   * 获取 Pipeline 各组件（用于自定义组装）
   */
  getComponents(): {
    vectorService: VectorStoreService;
    chunker: DocumentChunker;
    retriever: RAGRetriever;
    bm25Retriever: BM25Retriever;
    reranker: Reranker | null;
  } {
    return {
      vectorService: this.vectorService,
      chunker: this.chunker,
      retriever: this.retriever,
      bm25Retriever: this.bm25Retriever,
      reranker: this.reranker,
    };
  }

  /**
   * 获取 LangChain Retriever（用于集成到 LangChain Chain）
   * 
   * 示例：
   *   const retriever = rag.asRetriever();
   *   const chain = RetrievalQAChain.fromLLM(llm, retriever);
   */
  asRetriever(topK?: number): any {
    return this.vectorService.asRetriever(topK);
  }
}

export default RAGPipeline;