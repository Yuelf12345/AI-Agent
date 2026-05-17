/**
 * Reranker - 重排序模块
 * 
 * 核心概念：
 *   Reranker 是 RAG 流程中的"精排"环节。
 *   初次检索（向量/关键词/BM25）返回一批候选文档后，
 *   Reranker 用更精确的方法对候选文档重新排序，
 *   提升最终送给 LLM 的文档质量。
 * 
 * 检索流程：
 *   ┌──────────┐   ┌──────────┐   ┌──────────┐
 *   │  初检索   │──▶│  Rerank  │──▶│  Top-K   │──▶ LLM
 *   │ (粗排)    │   │ (精排)    │   │ (截断)   │
 *   └──────────┘   └──────────┘   └──────────┘
 *   返回 top-20    重排序后取 top-5   最终结果
 * 
 * 为什么需要 Rerank：
 *   - 向量检索擅长语义匹配，但不擅长精确匹配
 *   - BM25 擅长关键词匹配，但不理解语义
 *   - Reranker 综合考虑：语义相关度 + 关键词覆盖 + 文档质量
 * 
 * 本实现提供三种 Rerank 策略：
 *   1. CrossEncoder: 使用 LLM 对每条 (query, doc) 重新评分（最准确，最慢）
 *   2. ScoreFusion: 多路检索分数融合排序（快速，无需额外模型）
 *   3. Diversity: 去重 + 多样性排序（避免重复文档）
 */

import { Document } from "@langchain/core/documents";
import type { EnrichedRetrievalResult } from "./retriever.ts";
import { llmService } from "../llm.ts";

/**
 * Rerank 策略类型
 */
export type RerankStrategy = "cross_encoder" | "score_fusion" | "diversity";

/**
 * Reranker 配置
 */
export interface RerankerConfig {
  /** 重排序策略 */
  strategy: RerankStrategy;
  /** 初检索返回数量（粗排），Reranker 从这些候选中精排 */
  candidateCount: number;
  /** 最终返回数量（精排后） */
  finalTopK: number;
  /** 多样性阈值：内容相似度超过此值的文档会被去重 */
  diversityThreshold: number;
}

const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
  strategy: "score_fusion",
  candidateCount: 20,
  finalTopK: 5,
  diversityThreshold: 0.7,
};

/**
 * Reranker 模块
 * 
 * 使用方式：
 *   const reranker = new Reranker({ strategy: "score_fusion" });
 *   const reranked = await reranker.rerank(query, candidates);
 * 
 * 或集成到 Pipeline：
 *   pipeline.retrieve → pipeline.rerank → 最终结果
 */
export class Reranker {
  private config: RerankerConfig;

  constructor(configOverride?: Partial<RerankerConfig>) {
    this.config = { ...DEFAULT_RERANKER_CONFIG, ...configOverride };
  }

  /**
   * 重排序
   * 
   * 根据配置的策略，对候选文档重新排序：
 *   - cross_encoder: LLM 逐一评分（最准确）
 *   - score_fusion: 分数融合 + 加权（最快）
 *   - diversity: 去重 + 多样性排序
   * 
   * @param query 用户查询
   * @param candidates 初检索候选文档
   */
  async rerank(
    query: string,
    candidates: EnrichedRetrievalResult[],
  ): Promise<EnrichedRetrievalResult[]> {
    switch (this.config.strategy) {
      case "cross_encoder":
        return await this._crossEncoderRerank(query, candidates);
      case "score_fusion":
        return this._scoreFusionRerank(query, candidates);
      case "diversity":
        return this._diversityRerank(query, candidates);
      default:
        return candidates.slice(0, this.config.finalTopK);
    }
  }

  // ==================== Cross-Encoder 精排 ====================

  /**
   * Cross-Encoder 重排序
   * 
   * 原理：将 (query, doc) 作为一对输入给 LLM，
 *   LLM 直接判断这对输入的相关性，输出 0-1 的相关度分数。
 * 
 *   优点：最准确（能理解 query 和 doc 的深层语义关系）
 *   缺点：最慢（每个候选文档都需要一次 LLM 调用）
 * 
   *   适用场景：候选文档少（<10），对准确性要求高
   */
  private async _crossEncoderRerank(
    query: string,
    candidates: EnrichedRetrievalResult[],
  ): Promise<EnrichedRetrievalResult[]> {
    const scored: EnrichedRetrievalResult[] = [];

    for (const candidate of candidates) {
      try {
        const prompt = `请评估以下查询与文档的相关性，只输出一个0到1之间的数字分数（0=完全不相关，1=完全相关）。
不要输出任何其他内容。

查询: ${query}
文档: ${candidate.document.pageContent.slice(0, 300)}

相关性分数:`;

        const response = await llmService.chat([{ role: "user", content: prompt }]);
        const score = parseFloat(response.trim());

        if (isNaN(score) || score < 0 || score > 1) {
          // LLM 输出不符合预期，保留原始分数
          scored.push({ ...candidate, finalScore: candidate.finalScore });
        } else {
          scored.push({ ...candidate, finalScore: score });
        }
      } catch (error: any) {
        console.log(`[Reranker] Cross-Encoder error: ${error.message}`);
        scored.push({ ...candidate, finalScore: candidate.finalScore });
      }
    }

    return scored
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, this.config.finalTopK);
  }

  // ==================== Score Fusion 排序 ====================

  /**
   * Score Fusion 重排序（快速）
   * 
   * 原理：不调用额外模型，而是综合多个信号重新计算分数：
 *   1. 原始检索分数（finalScore）
 *   2. 关键词覆盖度：query 中的关键词在文档中出现了多少
 *   3. 文档长度归一化：避免长文档因包含更多词而占优势
 *   4. 位置加分：如果关键词出现在文档开头，分数更高
 * 
 *   最终分数 = originalScore × 0.5 + keywordCoverage × 0.3 + positionBonus × 0.2
 * 
 *   优点：快速（无额外模型调用）
 *   缺点：不如 Cross-Encoder 准确
 * 
 *   适用场景：候选文档多，对速度要求高
   */
  private _scoreFusionRerank(
    query: string,
    candidates: EnrichedRetrievalResult[],
  ): Promise<EnrichedRetrievalResult[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

    const scored = candidates.map(candidate => {
      const content = candidate.document.pageContent.toLowerCase();

      // 1. 关键词覆盖度
      const coveredTerms = queryTerms.filter(term => content.includes(term)).length;
      const keywordCoverage = queryTerms.length > 0 ? coveredTerms / queryTerms.length : 0;

      // 2. 位置加分：关键词出现在前 20% 的内容中
      const firstPart = content.slice(0, Math.floor(content.length * 0.2));
      const earlyHits = queryTerms.filter(term => firstPart.includes(term)).length;
      const positionBonus = queryTerms.length > 0 ? (earlyHits / queryTerms.length) * 0.5 : 0;

      // 3. 综合分数
      const originalScore = candidate.finalScore;
      const rerankScore = originalScore * 0.5 + keywordCoverage * 0.3 + positionBonus * 0.2;

      return {
        ...candidate,
        finalScore: rerankScore,
        metadata: {
          ...candidate.metadata,
          rerankDetails: {
            originalScore,
            keywordCoverage,
            positionBonus,
            rerankScore,
          },
        },
      };
    });

    const result = scored
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, this.config.finalTopK);

    return Promise.resolve(result);
  }

  // ==================== Diversity 去重排序 ====================

  /**
   * Diversity 重排序
   * 
   * 原理：避免送给 LLM 的多篇文档内容过于相似。
 *   按分数排序后，逐篇检查与已选文档的内容相似度，
 *   如果太相似（> diversityThreshold），则跳过。
 * 
 *   相似度判断：基于关键词重叠率（简易策略）
 * 
 *   优点：确保 LLM 获得多角度的信息
 *   缺点：可能丢失高分但内容相似的文档
 * 
 *   适用场景：知识库中有很多重复/相似文档
   */
  private _diversityRerank(
    query: string,
    candidates: EnrichedRetrievalResult[],
  ): Promise<EnrichedRetrievalResult[]> {
    // 先按分数排序
    const sorted = [...candidates].sort((a, b) => b.finalScore - a.finalScore);

    const selected: EnrichedRetrievalResult[] = [];
    const selectedTerms: Set<string>[] = []; // 已选文档的关键词集

    for (const candidate of sorted) {
      if (selected.length >= this.config.finalTopK) break;

      const candidateTerms = new Set(
        candidate.document.pageContent
          .toLowerCase()
          .split(/\s+/)
          .filter(t => t.length > 2),
      );

      // 与已选文档计算关键词重叠率
      let maxOverlap = 0;
      for (const existingTerms of selectedTerms) {
        const overlapCount = [...candidateTerms].filter(t => existingTerms.has(t)).length;
        const overlapRate = candidateTerms.size > 0 ? overlapCount / candidateTerms.size : 0;
        maxOverlap = Math.max(maxOverlap, overlapRate);
      }

      // 如果与已选文档太相似，跳过
      if (maxOverlap > this.config.diversityThreshold && selected.length > 0) {
        continue;
      }

      selected.push(candidate);
      selectedTerms.push(candidateTerms);
    }

    return Promise.resolve(selected);
  }

  /** 获取当前配置 */
  getConfig(): RerankerConfig {
    return { ...this.config };
  }
}