/**
 * 向量存储服务 (Chroma)
 * 
 * 负责：文档向量的存储、检索、删除
 * 
 * RAG 核心概念：
 *   向量数据库是 RAG 的存储层。文档经过 Embedding 后变成向量，
 *   存入向量数据库。查询时，同样将 query 嵌入为向量，
 *   通过"向量相似度搜索"（cosine similarity / L2 distance）找到最相关的文档。
 * 
 * Chroma 是一个轻量级的本地向量数据库，适合开发和小规模使用。
 * 
 * 本模块同时提供 LangChain 集成的向量存储（用于 RAG chain）
 * 和原生 Chroma 操作（用于精细控制）
 */

import { Chroma } from "@langchain/community/vectorstores/chroma";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { ChromaClient } from "chromadb";
import type { Collection } from "chromadb";
import { embeddingService } from "./embedding.ts";
import { config } from "../config/index.ts";

/**
 * 向量存储配置
 */
export interface VectorStoreConfig {
  collectionName: string;
  chromaHost: string;
  chromaPort: number;
}

/**
 * 文档检索结果
 */
export interface RetrievalResult {
  document: Document;
  score: number; // 相似度分数（越高越相似）
  metadata: Record<string, unknown>;
}

/**
 * 向量存储服务
 * 
 * 使用方式：
 *   const vectorService = new VectorStoreService();
 *   
 *   // 索引文档
 *   await vectorService.addDocuments([
 *     new Document({ pageContent: "RAG 是检索增强生成...", metadata: { source: "notes" } }),
 *   ]);
 *   
 *   // 检索相似文档
 *   const results = await vectorService.similaritySearch("什么是 RAG", 5);
 */
export class VectorStoreService {
  private client: ChromaClient;
  private langchainStore: Chroma | null = null;
  private collectionName: string;
  private embeddings: Embeddings;

  constructor(configOverride?: Partial<VectorStoreConfig>) {
    const finalConfig = {
      collectionName: configOverride?.collectionName || "harness_notes",
      chromaHost: configOverride?.chromaHost || config.storage.chroma.host,
      chromaPort: configOverride?.chromaPort || config.storage.chroma.port,
    };

    this.collectionName = finalConfig.collectionName;
    this.embeddings = embeddingService.getEmbeddings();

    // 原生 Chroma 客户端（用于精细操作）
    this.client = new ChromaClient({
      path: `http://${finalConfig.chromaHost}:${finalConfig.chromaPort}`,
    });
  }

  /**
   * 初始化向量存储
   * 
   * 必须在使用前调用。Chroma 服务需要提前启动：
   *   chroma run --host localhost --port 8000
   */
  async initialize(): Promise<void> {
    try {
      // 使用 LangChain 的 Chroma 向量存储
      // 它会自动创建/获取 collection 并配置 embedding 函数
      this.langchainStore = await Chroma.fromExistingCollection(
        this.embeddings,
        {
          collectionName: this.collectionName,
          url: `http://${config.storage.chroma.host}:${config.storage.chroma.port}`,
        },
      );
      console.log(`[VectorStore] Initialized collection: ${this.collectionName}`);
    } catch (error: any) {
      console.error(`[VectorStore] Init failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 添加文档到向量存储
   * 
   * 这是 RAG 索引的核心步骤：文档 → Embedding → 存入 Chroma
   * 
   * @param docs LangChain Document 数组，每个 Document 包含：
   *   - pageContent: 文档文本内容
   *   - metadata: 元数据（source, tags, created_at 等）
   */
  async addDocuments(docs: Document[]): Promise<void> {
    if (!this.langchainStore) {
      await this.initialize();
    }

    // LangChain 的 addDocuments 会自动：
    // 1. 调用 Embedding 模型将 pageContent 转为向量
    // 2. 将向量 + metadata 存入 Chroma collection
    await this.langchainStore!.addDocuments(docs);
    console.log(`[VectorStore] Added ${docs.length} documents`);
  }

  /**
   * 从文本直接创建向量存储
   * 
   * 适合首次批量导入文档的场景：
   *   const store = await VectorStoreService.fromTexts(
   *     ["文档1内容", "文档2内容"],
   *     [{ source: "note1" }, { source: "note2" }],
   *     embeddings,
   *   );
   * 
   * @param texts 文档文本数组
   * @param metadatas 对应的元数据数组
   * @returns 初始化好的 VectorStoreService
   */
  static async fromTexts(
    texts: string[],
    metadatas: Record<string, unknown>[] | undefined,
    embeddings?: Embeddings,
  ): Promise<VectorStoreService> {
    const service = new VectorStoreService();
    const finalEmbeddings = embeddings || embeddingService.getEmbeddings();

    service.langchainStore = await Chroma.fromTexts(
      texts,
      metadatas || texts.map(() => ({ source: "unknown" })),
      finalEmbeddings,
      {
        collectionName: service.collectionName,
        url: `http://${config.storage.chroma.host}:${config.storage.chroma.port}`,
      },
    );

    console.log(`[VectorStore] Created from ${texts.length} texts`);
    return service;
  }

  /**
   * 相似度搜索（向量检索）
   * 
   * RAG 的检索核心：将 query 嵌入为向量，在 Chroma 中找到最相似的文档
   * 
   * @param query 查询文本
   * @param topK 返回最相似的 K 个结果（默认 5）
   * @returns Document 数组，按相似度排序
   */
  async similaritySearch(query: string, topK?: number): Promise<Document[]> {
    if (!this.langchainStore) {
      await this.initialize();
    }
    const k = topK || config.memory.longTermMemory.topK;
    return await this.langchainStore!.similaritySearch(query, k);
  }

  /**
   * 带分数的相似度搜索
   * 
   * 返回结果包含相似度分数，便于阈值过滤和调试
   * 
   * @param query 查询文本
   * @param topK 返回数量
   * @returns RetrievalResult 数组，包含 Document + score
   */
  async similaritySearchWithScore(
    query: string,
    topK?: number,
  ): Promise<RetrievalResult[]> {
    if (!this.langchainStore) {
      await this.initialize();
    }
    const k = topK || config.memory.longTermMemory.topK;

    // LangChain 的 similaritySearchWithScore 返回 [Document, number][] 
    const results = await this.langchainStore!.similaritySearchWithScore(query, k);

    return results.map(([doc, score]) => ({
      document: doc,
      score: score,
      metadata: doc.metadata as Record<string, unknown>,
    }));
  }

  /**
   * 原生 Chroma 查询（更多控制选项）
   * 
   * 可以指定 where 过滤条件、include 返回字段等
   * 
   * @param queryVector 查询向量（需要先用 embeddingService.embedQuery 生成）
   * @param topK 返回数量
   * @param where 元数据过滤条件（如 { tags: "work" }）
   * @returns Chroma 原生查询结果
   */
  async rawQuery(
    queryVector: number[],
    topK?: number,
    where?: Record<string, unknown>,
  ): Promise<{
    ids: string[][];
    documents: (string | null)[][];
    metadatas: (Record<string, unknown> | null)[][];
    distances: (number | null)[][];
  }> {
    const collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
    });

    const k = topK || config.memory.longTermMemory.topK;

    return await collection.query({
      queryEmbeddings: [queryVector],
      nResults: k,
      where: where as any,
      include: ["documents", "metadatas", "distances"],
    });
  }

  /**
   * 删除文档
   * 
   * @param ids 要删除的文档 ID 列表
   */
  async deleteDocuments(ids: string[]): Promise<void> {
    const collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
    });
    await collection.delete({ ids });
    console.log(`[VectorStore] Deleted ${ids.length} documents`);
  }

  /**
   * 删除并重建整个 collection
   */
  async reset(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.collectionName });
      console.log(`[VectorStore] Deleted collection: ${this.collectionName}`);
    } catch (error: any) {
      // Collection 不存在时忽略错误
      if (!error.message?.includes("not exist")) {
        console.log(`[VectorStore] Collection not found, will create new one`);
      }
    }
    this.langchainStore = null;
  }

  /**
   * 获取 collection 中的文档数量
   */
  async count(): Promise<number> {
    const collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
    });
    return await collection.count();
  }

  /**
   * 获取原生 Chroma Collection（用于高级操作）
   */
  async getCollection(): Promise<Collection> {
    return await this.client.getOrCreateCollection({
      name: this.collectionName,
    });
  }

  /**
   * 获取 LangChain 向量存储实例（用于集成到 chain）
   */
  getLangchainStore(): Chroma | null {
    return this.langchainStore;
  }

  /**
   * 作为 LangChain Retriever 使用
   * 
   * 可以直接嵌入 LangChain 的 RetrievalQA chain：
   *   const retriever = vectorService.asRetriever(5);
   *   const chain = RetrievalQAChain.fromLLM(llm, retriever);
   */
  asRetriever(topK?: number): any {
    if (!this.langchainStore) {
      throw new Error("VectorStore not initialized. Call initialize() first.");
    }
    const k = topK || config.memory.longTermMemory.topK;
    return this.langchainStore.asRetriever(k);
  }
}

export default VectorStoreService;