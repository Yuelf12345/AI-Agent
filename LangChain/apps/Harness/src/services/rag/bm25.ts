/**
 * BM25 关键词检索器
 * 
 * BM25（Best Matching 25）是信息检索领域最经典的排序算法，
 * 是 TF-IDF 的改进版本，广泛应用于搜索引擎。
 * 
 * BM25 vs TF-IDF：
 *   TF-IDF: score = tf × idf
 *     问题：词频越高分数越高（无上限），长文档占优势
 *   
 *   BM25: score = tf_normalized × idf
 *     改进：tf 有饱和函数（k1 参数控制），长文档不会占优势
 *     公式：BM25(D, Q) = Σ IDF(qi) × (f(qi,D) × (k1+1)) / (f(qi,D) + k1 × (1-b+b×|D|/avgdl))
 * 
 * 参数说明：
 *   k1 = 1.2: 词频饱和参数，控制 tf 的影响上限
 *   b = 0.75: 文档长度归一化参数，b=1 完全归一化，b=0 不归一化
 * 
 * 本实现特点：
 *   - 纯 TypeScript 实现，无需外部依赖
 *   - 支持中英文混合分词
 *   - 自动计算 IDF 和文档长度归一化
 */

import { Document } from "@langchain/core/documents";

export interface BM25Config {
  /** 词频饱和参数 k1（默认 1.2） */
  k1: number;
  /** 文档长度归一化参数 b（默认 0.75） */
  b: number;
  /** 最小词长度（过滤单字符噪声） */
  minTermLength: number;
}

const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
  minTermLength: 1,
};

/**
 * BM25 检索器
 * 
 * 使用方式：
 *   const bm25 = new BM25Retriever();
 *   bm25.loadDocuments(docs);
 *   const results = bm25.search("什么是 RAG", 5);
 * 
 * 内部流程：
 *   1. loadDocuments → 分词 + 计算每篇文档的词频和长度
 *   2. search → 对 query 分词 → 计算 IDF → 对每篇文档算 BM25 分数 → 排序
 */
export class BM25Retriever {
  private config: BM25Config;
  private corpus: Array<{
    doc: Document;
    terms: string[];
    termFreqs: Map<string, number>; // 每个词在文档中的频率
    docLength: number; // 文档词数
  }> = [];
  private avgDocLength: number = 0; // 平均文档长度
  private docCount: number = 0; // 文档总数
  private idfCache: Map<string, number> = new Map(); // IDF 缓存

  constructor(configOverride?: Partial<BM25Config>) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...configOverride };
  }

  /**
   * 加载文档到 BM25 检索库
   * 
   * 对每篇文档：
   *   1. 分词（tokenize）
   *   2. 统计词频（termFreqs）
   *   3. 记录文档长度
   * 
   * 加载完成后自动计算：
   *   - avgDocLength（平均文档长度）
   *   - IDF（逆文档频率）
   */
  loadDocuments(docs: Document[]): void {
    this.corpus = docs.map(doc => {
      const terms = this.tokenize(doc.pageContent);
      const termFreqs = new Map<string, number>();

      for (const term of terms) {
        termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
      }

      return {
        doc,
        terms,
        termFreqs,
        docLength: terms.length,
      };
    });

    this.docCount = this.corpus.length;
    this.avgDocLength = this.corpus.reduce((sum, c) => sum + c.docLength, 0) / this.docCount;
    this._computeIDF();
    console.log(`[BM25] Loaded ${this.docCount} documents, avg length: ${this.avgDocLength.toFixed(1)}`);
  }

  /**
   * BM25 搜索
   * 
   * 对每个 query term：
   *   1. 查 IDF
   *   2. 对每篇文档计算 BM25 分数
   *   3. 累加所有 query term 的分数
   *   4. 按总分排序
   * 
   * @param query 查询文本
   * @param topK 返回数量
   */
  search(query: string, topK: number): Array<{ doc: Document; score: number }> {
    const queryTerms = this.tokenize(query);

    if (queryTerms.length === 0) return [];

    const scored = this.corpus.map(entry => {
      let totalScore = 0;

      for (const term of queryTerms) {
        const tf = entry.termFreqs.get(term) || 0;
        const idf = this.idfCache.get(term) || 0;

        if (idf === 0) continue; // term 不在语料库中，跳过

        // BM25 核心公式
        const tfNormalized = (tf * (this.config.k1 + 1)) /
          (tf + this.config.k1 * (1 - this.config.b + this.config.b * (entry.docLength / this.avgDocLength)));

        totalScore += idf * tfNormalized;
      }

      return { doc: entry.doc, score: totalScore };
    });

    return scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * 计算 IDF（逆文档频率）
   * 
   * IDF(qi) = log((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
   * 
   * 其中：
   *   N = 文档总数
   *   n(qi) = 包含词 qi 的文档数
   * 
   * IDF 的含义：
   *   - 出现在所有文档中的词 → IDF 低（如"的"、"是"）
   *   - 只出现在少数文档中的词 → IDF 高（如"Chroma"、"BM25"）
   */
  private _computeIDF(): void {
    // 统计每个词出现在多少篇文档中
    const docFreqs = new Map<string, number>();
    for (const entry of this.corpus) {
      const uniqueTerms = new Set(entry.terms);
      for (const term of uniqueTerms) {
        docFreqs.set(term, (docFreqs.get(term) || 0) + 1);
      }
    }

    // 计算 IDF
    for (const [term, df] of docFreqs) {
      const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(term, idf);
    }
  }

  /**
   * 分词器（中英文混合）
   * 
   * 策略：
   *   1. 英文：按空格拆分，小写化
   *   2. 中文：按单字拆分（简单策略，生产环境应使用 jieba 等分词库）
   *   3. 过滤短词（< minTermLength）
   *   4. 过滤标点符号
   */
  private tokenize(text: string): string[] {
    const terms: string[] = [];

    // 提取英文词
    const englishWords = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const word of englishWords) {
      if (word.length >= this.config.minTermLength) {
        terms.push(word);
      }
    }

    // 提取中文字符（每2个字为一个词组，简易策略）
    const chineseChars = text.match(/[\u4e00-\u9fff]+/g) || [];
    for (const segment of chineseChars) {
      // 双字分词（bigram）
      for (let i = 0; i < segment.length - 1; i++) {
        terms.push(segment.slice(i, i + 2));
      }
      // 单字也加入（短文档需要）
      if (segment.length <= 2) {
        terms.push(segment);
      }
    }

    return terms;
  }

  /** 获取语料库统计信息 */
  getStats(): { docCount: number; avgDocLength: number; uniqueTerms: number } {
    return {
      docCount: this.docCount,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.idfCache.size,
    };
  }
}