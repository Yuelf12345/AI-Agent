/**
 * RAG 检索器 (Retriever)
 * 
 * 负责：从向量数据库中检索与查询最相关的文档片段
 * 
 * RAG 核心概念：
 *   检索是 RAG 的"R"（Retrieval）—— 从大量已索引的文档中，
 *   找出与用户查询语义最相关的片段，提供给 LLM 作为生成依据。
 *   
 *   检索质量直接影响 RAG 的效果：
 *   - 检索到不相关的文档 → LLM 生成"跑题"的答案
 *   - 检索到高质量的文档 → LLM 生成准确、有据可依的答案
 *   
 *   本模块实现混合检索策略：
 *   1. 向量检索（语义相似度）—— 捕捉语义层面的相关性
 *   2. 关键词检索（BM25 或简单匹配）—— 捕捉字面层面的精确匹配
 *   3. 加权融合 —— 综合两者优势
 */

import { Document } from "@langchain/core/documents";
import { VectorStoreService } from "../vector.ts";
import type { RetrievalResult } from "../vector.ts";
import { embeddingService } from "../embedding.ts";
import { config } from "../../config/index.ts";

/**
 * 检索结果（包含来源信息）
 */
export interface EnrichedRetrievalResult extends RetrievalResult {
  source: "vector" | "keyword" | "hybrid"; // 检索来源
  finalScore: number; // 最终加权分数
}

/**
 * 混合检索权重配置
 * 
 * 根据 PRD 设计：
 *   向量检索权重 0.7（擅长语义相似）
 *   关键词检索权重 0.3（擅长精确匹配）
 */
export interface HybridWeights {
  vectorWeight: number;
  keywordWeight: number;
}

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  vectorWeight: 0.7,
  keywordWeight: 0.3,
};

/**
 * 简易关键词检索器
 * 
 * 使用 TF 匹配（Term Frequency）作为简易 BM25 替代。
 * 生产环境应使用真正的 BM25 库（如 rank-bm25 npm 包）。
 * 
 * 原理：计算 query 中的关键词在文档中出现的频率，
 *   频率越高 → 文档与 query 的字面匹配度越高
 */
class KeywordRetriever {
  private documents: Document[] = [];

  /**
   * 加载文档到关键词检索器
   */
  loadDocuments(docs: Document[]): void {
    this.documents = docs;
  }

  /**
   * TF 关键词检索
   * 
   * @param query 查询文本
   * @param topK 返回数量
   * @returns 匹配的文档及其 TF 分数
   */
  search(query: string, topK: number): Array<{ doc: Document; score: number }> {
    const queryTerms = this.extractTerms(query);
    
    const scored = this.documents.map((doc) => {
      const docTerms = this.extractTerms(doc.pageContent);
      
      // 计算 TF：query 中有多少词在文档中出现
      let matchCount = 0;
      for (const term of queryTerms) {
        if (docTerms.includes(term)) {
          matchCount++;
        }
      }

      // 分数 = 匹配词数 / query 词数（归一化）
      const score = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
      return { doc, score };
    });

    // 按分数降序排序，返回 topK
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((r) => r.score > 0); // 过滤掉零分数
  }

  /**
   * 简易分词：小写化 + 按空格/标点拆分
   */
  private extractTerms(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, " ") // 保留中文和英文
      .split(/\s+/)
      .filter((t) => t.length > 1); // 过滤单字符
  }
}

/**
 * RAG 检索器
 * 
 * 使用方式：
 *   const retriever = new RAGRetriever(vectorService);
 *   retriever.setKeywordDocuments(allDocs);  // 加载关键词检索库
 *   
 *   // 纯向量检索
 *   const vectorResults = await retriever.vectorSearch("什么是 RAG");
 *   
 *   // 混合检索
 *   const hybridResults = await retriever.hybridSearch("什么是 RAG");
 */
export class RAGRetriever {
  private vectorService: VectorStoreService;
  private keywordRetriever: KeywordRetriever;
  private weights: HybridWeights;

  constructor(
    vectorService: VectorStoreService,
    weights?: HybridWeights,
  ) {
    this.vectorService = vectorService;
    this.keywordRetriever = new KeywordRetriever();
    this.weights = weights || DEFAULT_HYBRID_WEIGHTS;
  }

  /**
   * 设置关键词检索的文档库
   * 
   * 混合检索需要同时在向量库和关键词库中搜索，
   * 关键词库需要单独维护一份文档副本
   */
  setKeywordDocuments(docs: Document[]): void {
    this.keywordRetriever.loadDocuments(docs);
  }

  /**
   * 纯向量检索
   * 
   * 流程：query → Embedding → Chroma similaritySearch → 结果
   * 
   * 优点：能捕捉语义相似（"AI助手" 能匹配到 "智能助理"）
   * 缺点：对精确关键词匹配较弱
   * 
   * @param query 查询文本
   * @param topK 返回数量
   * @returns 检索结果
   */
  async vectorSearch(query: string, topK?: number): Promise<EnrichedRetrievalResult[]> {
    const k = topK || config.memory.longTermMemory.topK;
    const results = await this.vectorService.similaritySearchWithScore(query, k);

    return results.map((r) => ({
      ...r,
      source: "vector",
      finalScore: r.score * this.weights.vectorWeight,
    }));
  }

  /**
   * 纯关键词检索
   * 
   * 流程：query → 分词 → TF 匹配 → 结果
   * 
   * 优点：精确匹配关键词（搜索 "LangChain" 能精确命中包含这个词的文档）
   * 缺点：无法理解语义（"大语言模型" 无法匹配到 "LLM")
   */
  keywordSearch(query: string, topK?: number): EnrichedRetrievalResult[] {
    const k = topK || config.memory.longTermMemory.topK;
    const results = this.keywordRetriever.search(query, k);

    return results.map((r) => ({
      document: r.doc,
      score: r.score,
      metadata: r.doc.metadata as Record<string, unknown>,
      source: "keyword",
      finalScore: r.score * this.weights.keywordWeight,
    }));
  }

  /**
   * 混合检索（向量 + 关键词）
   * 
   * 流程：
   *   1. 向量检索 → 得到向量候选集
   *   2. 关键词检索 → 得到关键词候选集
   *   3. 加权融合 → 按 finalScore 合并排序
   *   4. 阈值过滤 → 去掉低质量结果
   *   5. 去重 → 同一文档可能被两种方式检索到
   * 
   * 这是 RAG 检索的最佳实践：
   *   语义 + 字面 双通道互补，检索质量显著优于单一方式
   * 
   * @param query 查询文本
   * @param topK 返回数量
   * @returns 混合检索结果
   */
  async hybridSearch(query: string, topK?: number): Promise<EnrichedRetrievalResult[]> {
    const k = topK || config.memory.longTermMemory.topK;

    // 双通道检索
    const vectorResults = await this.vectorSearch(query, k);
    const keywordResults = this.keywordSearch(query, k);

    // 合并结果
    const allResults = [...vectorResults, ...keywordResults];

    // 去重：同一文档内容可能被两种方式检索到
    // 按 pageContent 去重，保留分数更高的
    const deduplicated = this.deduplicate(allResults);

    // 阈值过滤：去掉低于 threshold 的低质量结果
    const threshold = config.memory.longTermMemory.threshold;
    const filtered = deduplicated.filter((r) => r.finalScore >= threshold * 0.1);

    // 按 finalScore 排序，返回 topK
    return filtered
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, k);
  }

  /**
   * 去重：同一文档内容被多种方式检索到时，保留分数最高的
   */
  private deduplicate(
    results: EnrichedRetrievalResult[],
  ): EnrichedRetrievalResult[] {
    const seen = new Map<string, EnrichedRetrievalResult>();

    for (const result of results) {
      const key = result.document.pageContent.slice(0, 100); // 用前100字符作为去重键
      const existing = seen.get(key);

      if (!existing || result.finalScore > existing.finalScore) {
        seen.set(key, result);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 更新混合检索权重
   */
  setWeights(weights: HybridWeights): void {
    this.weights = weights;
  }
}

export default RAGRetriever;