const document_list = [
  "行政机关强行解除行政协议造成损失,如何索取赔偿?",
  "借钱给朋友到期不还得什么时候可以起诉?怎么起诉?",
  "我在微信上被骗了,请问被骗多少钱才可以立案?",
  "公民对于选举委员会对选民的资格申诉的处理决定不服,能不能去法院起诉吗?",
  "有人走私两万元,怎么处置他?",
  "法律上餐具、饮具集中消毒服务单位的责任是不是对消毒餐具、饮具进行检验?",
];

const term_list: string[][] = [
  ['行政', '机关', '强行', '解除', '行政', '协议', '造成', '损失', ',', '如何', '索取', '赔偿', '?'], 
  ['借钱', '给', '朋友', '到期', '不', '还', '得', '什么', '时候', '可以', '起诉', '?', '怎么', '起诉', '?'], 
  ['我', '在', '微信', '上', '被', '骗', '了', ',', '请问', '被', '骗', '多少', '钱', '才', '可以', '立案', '?'], 
  ['公民', '对于', '选举', '委员会', '对', '选民', '的', '资格', '申诉', '的', '处理', '决定', '不服', ',', '能', '不能', '去', '法院', '起诉', '吗', '?'],
  ['有人', '走私', '两万元', ',', '怎么', '处置', '他', '?'], 
  ['法律', '上', '餐具', '、', '饮具', '集中', '消毒', '服务', '单位', '的', '责任', '是不是', '对', '消毒', '餐具', '、', '饮具', '进行', '检验', '?'],
];

/**
 * TF-IDF（词频-逆文档频率）检索实现
 *
 * TF  = 某词在文档中出现的次数 / 文档总词数
 * IDF = log(文档总数 / 包含该词的文档数)
 * TF-IDF = TF × IDF
 */
class TFIDF {
  /** 原始文档列表 */
  private documents: string[];
  /** 已分词的词列表 */
  private terms: string[][];
  /** 所有文档的不重复词列表 */
  private vocabulary: string[] = [];
  /** 每个词出现在多少个文档中（用于 IDF） */
  private docFreq: Map<string, number> = new Map();
  /** 每篇文档的 TF 向量 */
  private tfVectors: Map<number, Map<string, number>> = new Map();

  constructor(documents: string[], terms: string[][]) {
    this.documents = documents;
    this.terms = terms;
    this.buildIndex();
  }

  /**
   * 构建 TF-IDF 索引
   *
   * 步骤：
   * 1. 统计每个词出现在多少个文档中 → docFreq
   * 2. 建立词典 → vocabulary
   * 3. 对每篇文档计算 TF 向量
   */
  private buildIndex(): void {
    const docCount = this.terms.length;

    // Step 1: 统计文档频率（每个词出现在多少篇文档中）
    for (const docTerms of this.terms) {
      const uniqueTerms = new Set(docTerms); // 同一文档反复出现的词只算 1 次
      for (const term of uniqueTerms) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
      }
    }

    // Step 2: 建立词典
    this.vocabulary = Array.from(this.docFreq.keys());

    // Step 3: 对每篇文档计算 TF
    for (let i = 0; i < docCount; i++) {
      const docTerms = this.terms[i]!;
      const totalTerms = docTerms.length;
      const tf: Map<string, number> = new Map();

      // 统计每个词在该文档中出现的次数
      const termCount = new Map<string, number>();
      for (const term of docTerms) {
        termCount.set(term, (termCount.get(term) || 0) + 1);
      }

      // TF = 词在该文档中的次数 / 文档总词数
      for (const [term, count] of termCount) {
        tf.set(term, count / totalTerms);
      }

      this.tfVectors.set(i, tf);
    }

    console.log(`📚 文档数: ${docCount}`);
    console.log(`📖 词典大小: ${this.vocabulary.length}`);
  }

  // ─── 核心计算 ─────────────────────────────────────────────

  /**
   * 计算某个词的 IDF
   *
   * IDF(w) = log(文档总数 / 包含 w 的文档数)
   *
   * 加 1 是为了防止除零（如果某个词在所有文档中出现，log(1)=0）
   */
  idf(term: string): number {
    const docCount = this.terms.length;
    const df = this.docFreq.get(term) || 0;
    return Math.log(docCount / (df + 1));
  }

  /**
   * 计算某篇文档中某个词的 TF-IDF
   *
   * TF-IDF(w, d) = TF(w, d) × IDF(w)
   */
  tfidf(docIndex: number, term: string): number {
    const tf = this.tfVectors.get(docIndex)?.get(term) || 0;
    return tf * this.idf(term);
  }

  // ─── 检索 ─────────────────────────────────────────────────

  /**
   * 对查询分词，计算每篇文档的 TF-IDF 总分
   *
   * Score(d, q) = Σ TF-IDF(w, d)  for w in query_terms
   */
  search(query: string): { docIndex: number; document: string; score: number }[] {
    // 简单分词（中文按字拆分，实际应用中需要用分词器）
    const queryTerms = [...new Set(this.tokenize(query))];

    const scores: { docIndex: number; document: string; score: number }[] = [];

    for (let i = 0; i < this.documents.length; i++) {
      let score = 0;

      for (const term of queryTerms) {
        score += this.tfidf(i, term);
      }

      if (score > 0) {
        scores.push({
          docIndex: i,
          document: this.documents[i]!.slice(0, 30) + "...",
          score,
        });
      }
    }

    // 按分数降序排列
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  /**
   * 分词：优先匹配词典中的整词，否则按空格/逗号/单字切分
   *
   * 因为 term_list 已经分好词（如 '起诉'），所以用词典做最大正向匹配
   */
  private tokenize(text: string): string[] {
    // 如果包含分隔符（空格/逗号），按分隔符切
    if (/[\s,，、]/.test(text)) {
      return text
        .split(/[\s,，、]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // 直接查词典：看这个 query 是否已经是词典里的词
    if (this.vocabulary.includes(text)) {
      return [text];
    }

    // 否则按单字切分
    return text.split("").filter((c) => c.trim());
  }

  // ─── 可视化 ───────────────────────────────────────────────

  /**
   * 打印某个词的 IDF 值
   */
  printIDF(): void {
    console.log("\n─── IDF 值（越稀有越高） ───");
    const sorted = this.vocabulary
      .map((term) => ({ term, idf: this.idf(term) }))
      .sort((a, b) => b.idf - a.idf)
      .slice(0, 15);

    sorted.forEach(({ term, idf }) => {
      const bar = "█".repeat(Math.round(idf * 5));
      console.log(`  ${term.padEnd(6)} IDF=${idf.toFixed(3)} ${bar}`);
    });
  }

  /**
   * 打印指定文档的 TF-IDF 详情
   */
  printDocDetail(docIndex: number): void {
    console.log(`\n─── 文档[${docIndex}] TF-IDF 详情 ───`);
    console.log(`原文: ${this.documents[docIndex]}`);

    const terms = [...(this.tfVectors.get(docIndex) || new Map()).entries()]
      .filter(([t]) => !/^[，、。？?,.!?]$/.test(t)) // 过滤标点
      .sort((a, b) => b[1] - a[1]);

    terms.forEach(([term, tf]) => {
      const score = this.tfidf(docIndex, term);
      console.log(`  ${term.padEnd(6)} TF=${tf.toFixed(3)}  IDF=${this.idf(term).toFixed(3)}  TF-IDF=${score.toFixed(4)}`);
    });
  }
}

// ═════════════════════════════════════════════════════════
//  使用示例
// ═════════════════════════════════════════════════════════

const tfidf = new TFIDF(document_list, term_list);

// 查看 IDF 值
tfidf.printIDF();

// 查看文档 0 的 TF-IDF 详情
tfidf.printDocDetail(0);

// 检索
console.log("\n─── 检索: 起诉 ───");
const results = tfidf.search("起诉");
results.forEach((r) =>
  console.log(`  doc[${r.docIndex}] 得分: ${r.score.toFixed(4)}  ${r.document}`),
);

console.log("\n─── 检索: 行政 赔偿 ───");
const results2 = tfidf.search("行政 赔偿");
results2.forEach((r) =>
  console.log(`  doc[${r.docIndex}] 得分: ${r.score.toFixed(4)}  ${r.document}`),
);