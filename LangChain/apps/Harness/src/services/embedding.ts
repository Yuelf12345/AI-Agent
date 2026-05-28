/**
 * Embedding 服务
 * 
 * 负责：将文本转换为向量（embedding），供向量检索使用
 * 
 * RAG 核心概念：
 *   Embedding 是 RAG 的第一步 —— 把文档和查询都映射到同一个向量空间，
 *   使得"语义相似"的文本在空间中距离更近，从而可以被检索到。
 * 
 * 支持 Ollama（本地）和 OpenAI（远程）两种 Embedding 提供者
 */

import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config/index.ts";

export type EmbeddingProvider = "ollama" | "openai";

/**
 * Embedding 服务类
 * 
 * 使用方式：
 *   const embeddingService = new EmbeddingService();
 *   
 *   // 单条文本 embedding
 *   const vector = await embeddingService.embedQuery("什么是 RAG？");
 *   
 *   // 批量 embedding（用于文档索引）
 *   const vectors = await embeddingService.embedDocuments(["文档1", "文档2"]);
 */
export class EmbeddingService {
  private provider: EmbeddingProvider;
  private embeddings: OllamaEmbeddings | OpenAIEmbeddings | null = null;

  constructor(provider?: EmbeddingProvider) {
    this.provider = provider || config.llm.provider;
  }

  /**
   * 获取 Embeddings 实例
   * 
   * LangChain 的 Embeddings 类统一了不同提供者的接口：
   *   - embedQuery(text)    → 单条查询文本 → 向量
   *   - embedDocuments([])  → 批量文档文本 → 向量数组
   */
  getEmbeddings(): OllamaEmbeddings | OpenAIEmbeddings {
    if (this.embeddings) return this.embeddings;

    if (this.provider === "ollama") {
      this.embeddings = new OllamaEmbeddings({
        baseUrl: config.llm.ollama.baseUrl,
        model: config.llm.ollama.embeddingModel, // 默认 nomic-embed-text
      });
    } else {
      this.embeddings = new OpenAIEmbeddings({
        apiKey: config.llm.openai.apiKey,
        model: config.llm.openai.embeddingModel,
        configuration: {
          baseURL: config.llm.openai.baseUrl,
        },
      });
    }

    return this.embeddings;
  }

  /**
   * 嵌入单条查询文本
   * 
   * 用途：将用户查询转换为向量，用于检索相似文档
   * 
   * @param text 查询文本
   * @returns 向量数组（维度取决于模型，nomic-embed-text 为 768，text-embedding-3-small 为 1536）
   */
  async embedQuery(text: string): Promise<number[]> {
    const embeddings = this.getEmbeddings();
    return await embeddings.embedQuery(text);
  }

  /**
   * 批量嵌入文档文本
   * 
   * 用途：将分块后的文档批量转换为向量，用于索引入库
   * 
   * @param texts 文档文本数组
   * @returns 向量数组（每个文档一个向量）
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embeddings = this.getEmbeddings();
    return await embeddings.embedDocuments(texts);
  }

  /**
   * 切换 Embedding 提供者
   */
  switchProvider(provider: EmbeddingProvider): void {
    this.provider = provider;
    this.embeddings = null;
  }

  /**
   * 获取当前向量维度
   * 
   * 不同模型产出不同维度的向量：
   *   nomic-embed-text → 768 维
   *   text-embedding-3-small → 1536 维
   */
  async getDimension(): Promise<number> {
    const sampleVector = await this.embedQuery("dimension test");
    return sampleVector.length;
  }
}

// 导出单例
export const embeddingService = new EmbeddingService();
export default EmbeddingService;