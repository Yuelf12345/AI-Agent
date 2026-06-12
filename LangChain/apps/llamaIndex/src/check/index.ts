/**
 * 分块（Chunking）
 *  *  * LlamaIndex 提供两种实现：
 *  1. TokenTextSplitter — 按 token 数切分
 *  2. SentenceSplitter   — 按句子边界切分，尽量保持句子完整性（本质是递归+固定大小混合）
 *
 * 核心思路：按预定义的字符数/token 数将文本分割成统一片段，
 * 相邻块之间保持重叠（Overlap），避免语义被截断后丢失上下文。
 *
 * 优点：实现简单、所有数据块大小相等、便于批处理
 * 缺点：可能打断句子或思路，重要信息可能分散在不同块中
 */

import {
  SentenceSplitter,
  TokenTextSplitter,
  SentenceWindowNodeParser
} from "@llamaindex/core/node-parser";

import { TextNode } from "@llamaindex/core/schema";
import { Settings } from "@llamaindex/core/global";

// ═══════════════════════════════════════════════════════════════════
//  共享工具函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 从指定位置开始找到最近的英文单词边界（空格/非字母数字）
 *
 * 确保切分不会把英文单词切成两半
 *
 * @param text  全文
 * @param pos   当前位置（到 pos 为止可以安全断开）
 * @returns     调整后的位置（向前找词首，或向后找词尾）
 */
function snapToWordBoundary(text: string, pos: number, direction: "forward" | "backward"): number {
  if (direction === "forward") {
    // 向前找：确保 pos 处的字符不在英文单词中间
    // 如果 text[pos-1] 和 text[pos] 都是英文字母 → pos 在单词中间 → 前移到词首
    if (pos > 0 && pos < text.length &&
        /[a-zA-Z]/.test(text[pos - 1]!) && /[a-zA-Z]/.test(text[pos]!)) {
      while (pos > 0 && /[a-zA-Z0-9]/.test(text[pos - 1]!)) {
        pos--;
      }
    }
  } else {
    // 向后找：确保 pos 处的字符不在英文单词中间
    // 如果 text[pos-1] 和 text[pos] 都是英文字母 → pos 在单词中间 → 后移到词尾
    if (pos > 0 && pos < text.length &&
        /[a-zA-Z]/.test(text[pos - 1]!) && /[a-zA-Z]/.test(text[pos]!)) {
      while (pos < text.length && /[a-zA-Z0-9]/.test(text[pos]!)) {
        pos++;
      }
    }
  }
  return pos;
}

/**
 * 以英文单词安全的方式切割文本
 *
 * 在 [start, end) 范围内取 chunk，确保不会切在英文单词中间
 */
function sliceSafe(text: string, start: number, end: number): string {
  const safeEnd = snapToWordBoundary(text, end, "backward");
  const safeStart = snapToWordBoundary(text, start, "forward");
  return text.slice(safeStart, safeEnd);
}

/**
 * 判断字符是否是中文/中文标点（非英文字符）
 */
function isChinese(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff; // CJK 统一表意文字
}

interface FixedSizeChunkConfig {
  /** 每个分块的最大字符数（默认 512） */
  chunkSize: number;
  /** 相邻分块的重叠字符数（默认 50） */
  chunkOverlap: number;
}
/** 基于固定大小切分 */
class FixedSizeChunk {
  private config: FixedSizeChunkConfig;

  constructor(config?: Partial<FixedSizeChunkConfig>) {
    this.config = {
      chunkSize: 512,
      chunkOverlap: 50,
      ...config,
    };

    if (this.config.chunkOverlap >= this.config.chunkSize) {
      throw new Error(
        `chunkOverlap (${this.config.chunkOverlap}) 必须小于 chunkSize (${this.config.chunkSize})`,
      );
    }
  }

  /**
   * 对单个文本字符串进行固定大小切分
   *
   * 算法：
   * 1. 从文本起始位置开始，每次前进 step = chunkSize - chunkOverlap 个字符
   * 2. 截取 [i, i + chunkSize) 的子串作为一个 chunk
   * 3. 重复直到覆盖全文
   *
   * 示意图：
   *   文本: |---chunk1---|---chunk2---|---chunk3---|
   *                |==overlap==|
   *                      |==overlap==|
   */
  splitText(text: string): string[] {
    const { chunkSize, chunkOverlap } = this.config;
    const chunks: string[] = [];

    if (text.length <= chunkSize) {
      return [text];
    }

    const step = chunkSize - chunkOverlap; // 每次前进的步长
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const chunk = sliceSafe(text, start, end).trim();

      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      start += step;

      // 如果剩余文本不足一个 overlap，说明已经全部覆盖
      if (end === text.length) break;
    }

    return chunks;
  }

  /**
   * 接收文档，执行固定大小切分，返回 LlamaIndex 兼容的 TextNode[]
   */
  splitDocuments(docs: { text: string; id_?: string }[]): TextNode[] {
    const nodes: TextNode[] = [];

    for (const doc of docs) {
      const chunks = this.splitText(doc.text);

      chunks.forEach((chunk, i) => {
        const node = new TextNode({
          text: chunk,
          id_: `${doc.id_ || "doc"}-chunk-${i}`,
        });
        nodes.push(node);
      });
    }

    return nodes;
  }
}

/**
 * 语义分块（Semantic Chunking）
 *
 * 核心思路：两阶段切分
 *   阶段 1（结构断点）：按编号、标题、空行等天然结构边界将文本分成"节"
 *   阶段 2（语义断点）：在节内计算相邻句子的 embedding 相似度，
 *             在语义"跳变"处断开，将连续高相似的句子合并为一个 chunk
 *
 * 优点：
 *   - 分块边界贴合语义，同一 chunk 内话题连贯
 *   - 不会跨编号/标题切分（如 "1. CRISPE" 和 "2. BROKE" 绝不在同一个 chunk）
 *   - 无 overlap 冗余，每个 chunk 信息密度高
 *
 * 缺点：依赖 embedding 模型，需要额外的 API 调用
 *
 * 算法流程：
 *   文本
 *     → 阶段1: 结构分节（编号/标题/空行）
 *     → 阶段2: 节内语义切分（句子拆分 → embedding → 相似度 → 断点 → 合并）
 *     → 输出 chunks
 */

interface SemanticChunkConfig {
  /** 每个 chunk 的最大字符数（默认 800） */
  chunkSize: number;
  /** 语义断点阈值 (0~1)，相邻句子相似度低于此值时切分（默认 0.5） */
  breakpointThreshold: number;
  /** chunk 最小字符数（默认 100），低于此值与相邻 chunk 合并 */
  minChunkSize: number;
}

/** 基于语义大小切分 */
class SemanticChunk {
  private config: SemanticChunkConfig;

  constructor(config?: Partial<SemanticChunkConfig>) {
    this.config = {
      chunkSize: 800,
      breakpointThreshold: 0.5,
      minChunkSize: 100,
      ...config,
    };

    if (this.config.minChunkSize >= this.config.chunkSize) {
      throw new Error(
        `minChunkSize (${this.config.minChunkSize}) 必须小于 chunkSize (${this.config.chunkSize})`,
      );
    }

    if (
      this.config.breakpointThreshold < 0 ||
      this.config.breakpointThreshold > 1
    ) {
      throw new Error(
        `breakpointThreshold (${this.config.breakpointThreshold}) 必须在 0~1 之间`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  阶段 1: 结构分节 — 按编号/标题/空行将文本切成"节"
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 按结构断点将文本分成"节"
   *
   * 结构断点规则（任一匹配即断开）：
   * 1. 编号开头：如 "1." "2." "3." 等
   * 2. Markdown 标题：如 "# " "## " "### "
   * 3. 符号列表开头：如 "✅" "❌" "🔹" "●"
   * 4. 空行（连续 2 个以上换行）
   */
  private splitSections(text: string): string[] {
    const lines = text.split("\n");
    const sections: string[] = [];
    let current = "";

    for (const line of lines) {
      const trimmed = line.trim();
      const isStructuralBreak =
        /^\d+\.\s/.test(trimmed) || // 编号: "1. xxx"
        /^#{1,6}\s/.test(trimmed) || // 标题: "# xxx"
        /^[✅❌🔹●◆■]/.test(trimmed) || // 特殊列表标记
        trimmed === ""; // 空行

      if (isStructuralBreak && current.trim()) {
        sections.push(current.trim());
        current = trimmed;
      } else {
        current += (current ? "\n" : "") + line;
      }
    }

    if (current.trim()) sections.push(current.trim());
    return sections.filter((s) => s.length >= 2);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  阶段 2: 节内语义切分 — embedding 相似度检测断点
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 将文本拆分成句子
   *
   * 断句仅依据：句号、问号、叹号、换行符
   * 不在冒号、引号、括号处断开
   * 保护英文数字中的 . （如 1.5s、3.0、React Hooks 等）
   */
  private splitSentences(text: string): string[] {
    // 步骤 1: 将 . ! ? 前/后加标记，排除数字场景（如 1.5 不断开）
    // 保护规则：数字.数字 → 不分离；英文单词.英文单词 → 不分离
    const protectedText = text
      // 数字.数字 → 保护
      .replace(/(\d)\.(\d)/g, "$1<DOT>$2")
      // 英文.英文（如 Dr.Smith 或 React.Hooks）→ 保护
      .replace(/([A-Za-z])\.([A-Za-z])/g, "$1<DOT>$2");

    // 只在 。！？.!?\n 处断开（. 已被保护不会被误断）
    const sentenceRegex = /[^。！？.!?\n]+[。！？.!?\n]?/g;
    const raw = protectedText.match(sentenceRegex) || [protectedText];

    // 后处理：恢复 <DOT> → . ，合并不该断开的情况
    const sentences: string[] = [];
    let buffer = "";

    for (const s of raw) {
      const trimmed = s.trim().replace(/<DOT>/g, ".");
      if (!trimmed) continue;

      buffer += (buffer ? " " : "") + trimmed;

      // 检查引号和括号是否闭合
      if (this.countUnclosedPairs(buffer) === 0) {
        sentences.push(buffer);
        buffer = "";
      }
    }

    if (buffer.trim()) sentences.push(buffer.trim());
    return sentences.filter((s) => s.length >= 2);
  }

  /**
   * 计算文本中未闭合的引号/括号对数
   */
  private countUnclosedPairs(text: string): number {
    let unclosed = 0;
    const pairs: [string, string][] = [
      ['"', '"'],
      ['"', '"'],
      ["'", "'"],
      ["(", ")"],
      ["（", "）"],
      ["[", "]"],
      ["【", "】"],
      ["{", "}"],
    ];

    for (const [open, close] of pairs) {
      let depth = 0;
      for (const ch of text) {
        if (ch === open) depth++;
        if (ch === close) depth = Math.max(0, depth - 1);
      }
      unclosed += depth;
    }

    return unclosed;
  }

  /**
   * 计算两个向量的余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 合并过小的 chunk
   *
   * 小于 minChunkSize 的 chunk 与相邻 chunk 合并（不超过 chunkSize）
   */
  private mergeSmallChunks(chunks: string[]): string[] {
    if (chunks.length <= 1) return chunks;

    const { minChunkSize, chunkSize } = this.config;
    const merged: string[] = [];
    let buffer = chunks[0]!;

    for (let i = 1; i < chunks.length; i++) {
      const next = chunks[i]!;

      if (
        buffer.length < minChunkSize &&
        buffer.length + next.length <= chunkSize
      ) {
        buffer += "\n" + next;
      } else {
        merged.push(buffer);
        buffer = next;
      }
    }

    // 最后一个 chunk 如果也过短，合并到前一个
    if (buffer.length < minChunkSize && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1]! + "\n" + buffer;
    } else {
      merged.push(buffer);
    }

    return merged;
  }

  /**
   * 对单个"节"进行语义切分
   *
   * 在节内按句子拆分 → 计算相邻句子 embedding 相似度 → 在断点处切分
   */
  private async splitSectionBySemantics(
    sectionText: string,
  ): Promise<string[]> {
    const { chunkSize, breakpointThreshold } = this.config;
    const sentences = this.splitSentences(sectionText);

    if (sentences.length <= 1 || sectionText.length <= chunkSize) {
      return [sectionText];
    }

    // ── 计算每个句子的 embedding ──
    const BATCH_SIZE = 10;
    const embeddings: number[][] = [];
    for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
      const batch = sentences.slice(i, i + BATCH_SIZE);
      const batchEmbeddings =
        await Settings.embedModel.getTextEmbeddings(batch);
      embeddings.push(...batchEmbeddings);
    }

    // ── 计算相邻句子间的相似度 ──
    const similarities: number[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      similarities.push(
        this.cosineSimilarity(embeddings[i]!, embeddings[i + 1]!),
      );
    }

    // ── 检测语义断点 ──
    const breakpoints: number[] = [0];
    for (let i = 0; i < similarities.length; i++) {
      if (similarities[i]! < breakpointThreshold) {
        breakpoints.push(i + 1);
      }
    }
    breakpoints.push(sentences.length);

    // ── 将断点之间的句子合并为 chunk ──
    const chunks: string[] = [];

    for (let i = 0; i < breakpoints.length - 1; i++) {
      const start = breakpoints[i]!;
      const end = breakpoints[i + 1]!;
      const chunk = sentences.slice(start, end).join("");

      // 超过最大长度 → 按句子逐步添加
      if (chunk.length > chunkSize) {
        let subChunk = "";
        for (let j = start; j < end; j++) {
          const candidate = subChunk + sentences[j]!;
          if (candidate.length > chunkSize && subChunk.length > 0) {
            chunks.push(subChunk.trim());
            subChunk = sentences[j]!;
          } else {
            subChunk = candidate;
          }
        }
        if (subChunk.trim()) chunks.push(subChunk.trim());
      } else if (chunk.length > 0) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  公开 API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 对单个文本字符串进行语义切分
   *
   * 两阶段算法：
   * 1. 结构分节：按编号/标题/空行将文本分成"节"
   * 2. 节内语义切分：计算相邻句子 embedding 相似度，在跳变处断开
   * 3. 合并过小的 chunk
   */
  async splitText(text: string): Promise<string[]> {
    // ── 阶段 1: 结构分节 ──
    const sections = this.splitSections(text);

    // ── 阶段 2: 节内语义切分 ──
    const allChunks: string[] = [];

    for (const section of sections) {
      // 整节不超过 chunkSize → 直接作为一个 chunk
      if (section.length <= this.config.chunkSize) {
        allChunks.push(section);
        continue;
      }

      // 超过 chunkSize → 节内做语义切分
      const sectionChunks = await this.splitSectionBySemantics(section);
      allChunks.push(...sectionChunks);
    }

    // ── 合并过小的 chunk ──
    return this.mergeSmallChunks(allChunks);
  }

  /**
   * 接收文档，执行语义切分，返回 LlamaIndex 兼容的 TextNode[]
   */
  async splitDocuments(
    docs: { text: string; id_?: string }[],
  ): Promise<TextNode[]> {
    const nodes: TextNode[] = [];

    for (const doc of docs) {
      const chunks = await this.splitText(doc.text);

      chunks.forEach((chunk, i) => {
        const node = new TextNode({
          text: chunk,
          id_: `${doc.id_ || "doc"}-semantic-${i}`,
        });
        nodes.push(node);
      });
    }

    return nodes;
  }
}

/**
 * 递归分块（Recursive Chunking）
 *
 * 核心思路：按照分隔符优先级从粗到细递归切分
 *
 * 算法流程：
 *   1. 用当前最粗的分隔符尝试切分
 *   2. 切出的块 < chunkSize → 保留
 *   3. 切出的块 > chunkSize → 用更细的分隔符递归切分
 *   4. 所有分隔符用完仍超长 → 按字符硬切
 *
 * 分隔符优先级（从粗到细）：
 *   \n\n\n（多个空行） → \n\n（段落） → \n（行） → 。（句号） → 字符
 *
 * 优点：保持语义完整性，粒度自适应
 * 缺点：递归可能导致大量小 chunk，需配合 chunkOverlap 缓解
 */

interface RecursiveChunkConfig {
  /** 每个分块的最大字符数（默认 512） */
  chunkSize: number;
  /** 相邻分块的重叠字符数（默认 50） */
  chunkOverlap: number;
  /** chunk 最小字符数（默认 50），低于此值与相邻 chunk 合并 */
  minChunkSize: number;
}

/** 分隔符优先级列表（从粗到细） */
// 注意：不使用英文 . 作为分隔符，以免切断数字（1.5s、3.0）或缩写（Dr.）
const SEPARATORS = [
  "\n\n\n", // 多个空行（章节边界）
  "\n\n", // 段落边界
  "\n", // 行边界
  "。", // 中文句号（句子边界）
  "！", // 叹号
  "？", // 问号
  ".", // 英文句号
  "!", // 英文叹号
  "?", // 英文问号
  ",", // 逗号
  "，", // 中文逗号
];

/** 基于递归划分 */
class RecursiveChunk {
  private config: RecursiveChunkConfig;

  constructor(config?: Partial<RecursiveChunkConfig>) {
    this.config = {
      chunkSize: 512,
      chunkOverlap: 50,
      minChunkSize: 50,
      ...config,
    };

    if (this.config.chunkOverlap >= this.config.chunkSize) {
      throw new Error(
        `chunkOverlap (${this.config.chunkOverlap}) 必须小于 chunkSize (${this.config.chunkSize})`,
      );
    }

    if (this.config.minChunkSize >= this.config.chunkSize) {
      throw new Error(
        `minChunkSize (${this.config.minChunkSize}) 必须小于 chunkSize (${this.config.chunkSize})`,
      );
    }
  }

  /**
   * 递归切分文本
   *
   * @param text  待切分文本
   * @param sepIdx 当前使用的分隔符索引（从 0 开始，越大粒度越细）
   */
  private recursiveSplit(text: string, sepIdx: number): string[] {
    const { chunkSize, minChunkSize } = this.config;
    const trimmed = text.trim();

    // 基本情况：文本已在 chunkSize 内，或没有更细的分隔符可用
    if (trimmed.length <= chunkSize || sepIdx >= SEPARATORS.length) {
      // 如果仍然超长且没有分隔符可用 → 按字符硬切
      if (trimmed.length > chunkSize) {
        return this.hardSplit(trimmed);
      }
      return [trimmed];
    }

    const separator = SEPARATORS[sepIdx]!;
    const parts = trimmed
      .split(separator)
      .map((s) => s.trim())
      .filter(Boolean);
    const result: string[] = [];

    // 当前分隔符无法有效切分（没有产生分隔效果）→ 尝试更细粒度
    if (parts.length === 1) {
      return this.recursiveSplit(trimmed, sepIdx + 1);
    }

    for (const part of parts) {
      if (part.length <= chunkSize) {
        result.push(part);
      } else {
        // 超出 → 递归用更细粒度切
        const subChunks = this.recursiveSplit(part, sepIdx + 1);
        result.push(...subChunks);
      }
    }

    // 同级贪婪合并：相邻 chunk 尽可能合并到 chunkSize 附近
    // 避免产生大量碎片化的短 chunk
    const merged: string[] = [];
    let buffer = result[0] ?? "";

    for (let i = 1; i < result.length; i++) {
      const next = result[i]!;
      const combined = buffer + separator + next;

      if (combined.length <= chunkSize) {
        // 合并后不超过限制 → 贪婪合并
        buffer = combined;
      } else if (buffer.length < minChunkSize) {
        // buffer 太短但合并下一块会超 → 仍然合并
        // 但限制溢出量不超过 chunkSize * 30%，避免越滚越大
        const overflow = combined.length - chunkSize;
        if (overflow <= chunkSize * 0.3) {
          buffer = combined;
        } else {
          merged.push(buffer);
          buffer = next;
        }
      } else {
        // buffer 已经足够 → 断开
        merged.push(buffer);
        buffer = next;
      }
    }

    // 最后一个 chunk 如果过短且还有前一个 → 合并到前一个
    if (buffer.length < minChunkSize && merged.length > 0) {
      merged[merged.length - 1] += separator + buffer;
    } else {
      merged.push(buffer);
    }

    return merged;
  }

  /**
   * 当所有分隔符都无效时，按字符硬切
   */
  private hardSplit(text: string): string[] {
    const { chunkSize } = this.config;
    const chunks: string[] = [];

    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize).trim();
      if (chunk) chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * 为相邻 chunk 添加 overlap
   *
   * 从当前 chunk 前后各取 overlap/2 字符拼接（保护英文单词不被切断）
   */
  private applyOverlap(chunks: string[]): string[] {
    const { chunkOverlap } = this.config;
    if (chunkOverlap === 0 || chunks.length <= 1) return chunks;

    return chunks.map((chunk, i) => {
      if (i === 0) return chunk;

      const prevChunk = chunks[i - 1]!;
      // 从 prevChunk 末尾取 overlap 字符，确保不切断英文单词
      const overlapStart = snapToWordBoundary(prevChunk, prevChunk.length - chunkOverlap, "forward");
      const overlapText = prevChunk.slice(overlapStart);

      return overlapText + chunk;
    });
  }

  /**
   * 对单个文本字符串进行递归切分
   *
   * 从最粗分隔符开始，逐级细化，直到所有 chunk 都在 chunkSize 内
   */
  splitText(text: string): string[] {
    const chunks = this.recursiveSplit(text, 0);
    return this.applyOverlap(chunks);
  }

  /**
   * 接收文档，执行递归切分，返回 LlamaIndex 兼容的 TextNode[]
   */
  splitDocuments(docs: { text: string; id_?: string }[]): TextNode[] {
    const nodes: TextNode[] = [];

    for (const doc of docs) {
      const chunks = this.splitText(doc.text);

      chunks.forEach((chunk, i) => {
        const node = new TextNode({
          text: chunk,
          id_: `${doc.id_ || "doc"}-recursive-${i}`,
        });
        nodes.push(node);
      });
    }

    return nodes;
  }
}

/**
 * LLM 理解切分（LLM-Powered Chunking）
 *
 * 核心思路：利用 LLM 理解语义的能力，生成语义独立且有意义的块。
 *
 * 为什么用 LLM 切分？
 *   - 前四种方法（固定大小/语义/递归/句子窗口）都基于规则或 embedding，
 *     无法真正"理解"内容
 *   - LLM 可以识别出语义上独立的话题边界，生成更自然的 chunk
 *   - 代价：计算量大、速度慢、依赖 LLM 可用性
 *
 * 算法流程：
 *   1. 按段落预切分成"窗口"（每窗口 ≤ maxContextChars，避免撑满 LLM 上下文）
 *   2. 对每个窗口，调用 LLM 识别语义边界并切分成块
 *   3. LLM 返回 JSON 数组，解析后收集
 *   4. 合并过小的 chunk
 *
 * 注意：LLM 上下文窗口有限，过长的文本需要分批处理
 */

interface LLMChunkConfig {
  /** 每个 chunk 的目标最大字符数（默认 800） */
  chunkSize: number;
  /** 相邻 chunk 的重叠字符数（默认 50） */
  chunkOverlap: number;
  /** 每次发给 LLM 的最大字符数（避免超出 LLM 上下文，默认 2000） */
  maxContextChars: number;
  /** chunk 最小字符数（默认 100），低于此值与相邻 chunk 合并 */
  minChunkSize: number;
}

/** LLM 切分系统提示词 */
const LLM_CHUNK_SYSTEM_PROMPT = `你是一个文本分块助手。你的任务是将给定的文本按语义切分成语义自包含的大块。

规则：
1. 每个块应当是语义自包含、连贯的独立段落
2. 只在自然的语义边界处切分（话题切换处）
3. 不修改文本内容，不增删改任何字符
4. 每个块尽量填满到接近上限字数，不要过度细分
5. 返回 JSON 字符串数组，每个元素是一个块

示例输出格式：
["块1的文本内容", "块2的文本内容", "块3的文本内容"]`;

/** 基于 LLM 理解切分 */
class LLMChunk {
  private config: LLMChunkConfig;

  constructor(config?: Partial<LLMChunkConfig>) {
    this.config = {
      chunkSize: 800,
      chunkOverlap: 50,
      maxContextChars: 2000,
      minChunkSize: 100,
      ...config,
    };

    if (this.config.chunkOverlap >= this.config.chunkSize) {
      throw new Error(
        `chunkOverlap (${this.config.chunkOverlap}) 必须小于 chunkSize (${this.config.chunkSize})`
      );
    }
  }

  /**
   * 将文本按段落切分成 LLM 一次能处理的"窗口"
   *
   * 每个窗口不超过 maxContextChars，相邻窗口之间有重叠段落保持上下文连贯
   */
  private splitIntoWindows(text: string): string[] {
    const { maxContextChars } = this.config;
    const paragraphs = text
      .split(/\n\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const windows: string[] = [];
    let current = "";

    for (const para of paragraphs) {
      if (current.length + para.length > maxContextChars && current.length > 0) {
        windows.push(current);
        // 保留最后一段作为窗口间 overlap
        const paras = text.split(/\n\n+/).filter(Boolean);
        const idx = paras.indexOf(para);
        const lastPara = idx > 0 ? paras[idx - 1]! : "";
        current = lastPara + "\n\n" + para;
      } else {
        current += (current ? "\n\n" : "") + para;
      }
    }

    if (current.trim()) windows.push(current.trim());
    return windows;
  }

  /**
   * 调用 LLM 对单个窗口进行语义切分
   */
  private async splitWindow(window: string): Promise<string[]> {
    const { chunkSize } = this.config;

    const response = await Settings.llm.chat({
      messages: [
        { content: LLM_CHUNK_SYSTEM_PROMPT, role: "system" },
        {
          content: `请将以下文本切分成语义独立的大块，每个块尽量填满到接近 ${chunkSize} 字。不要过度细分——如果相邻内容属于同一个话题请合并到一个块中。\n\n${window}`,
          role: "user",
        },
      ],
    });

    const text =
      typeof response.message.content === "string"
        ? response.message.content
        : response.message.content.map((c: any) => c.text ?? "").join("");

    return this.parseChunksFromLLMResponse(text);
  }

  /**
   * 从 LLM 返回文本中提取 JSON 数组
   *
   * 处理 LLM 可能用代码块包裹 JSON 的情况
   */
  private parseChunksFromLLMResponse(text: string): string[] {
    // 尝试提取 ```json ... ``` 包裹的内容
    const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonBlock ? jsonBlock[1]! : text;

    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter((s) => s.length > 0);
      }
    } catch {
      // JSON 解析失败 → 回退
    }

    // 回退方案：按空行或编号切分
    return text
      .split(/\n\n+/)
      .map((s) => s.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter((s) => s.length > 10);
  }

  /**
   * 从后向前贪婪合并相邻 chunk
   *
   * LLM 倾向于过度切分（200~300 字），利用贪婪合并将所有 chunk
   * 尽量合并到接近 chunkSize，除非再加一段就会超限
   */
  private greedyMerge(chunks: string[]): string[] {
    const { chunkSize } = this.config;
    if (chunks.length <= 1) return chunks;

    const merged: string[] = [];
    let buffer = chunks[0]!;

    for (let i = 1; i < chunks.length; i++) {
      const next = chunks[i]!;
      const combined = buffer + "\n\n" + next;

      if (combined.length <= chunkSize) {
        // 合并后不超过限制 → 贪婪合并
        buffer = combined;
      } else {
        // 再合并就超了 → 断开
        merged.push(buffer);
        buffer = next;
      }
    }

    if (merged.length > 0) {
      // 检查最后一个 chunk 是否能和倒数第二个合并（可能各自的 small chunk 合并后刚好不超）
      const last = merged[merged.length - 1]!;
      const combined = last + "\n\n" + buffer;
      if (combined.length <= chunkSize) {
        merged[merged.length - 1] = combined;
      } else {
        merged.push(buffer);
      }
    } else {
      merged.push(buffer);
    }

    return merged;
  }

  /**
   * 为相邻 chunk 添加 overlap
   */
  private applyOverlap(chunks: string[]): string[] {
    const { chunkOverlap } = this.config;
    if (chunkOverlap === 0 || chunks.length <= 1) return chunks;

    return chunks.map((chunk, i) => {
      if (i === 0) return chunk;
      const prevChunk = chunks[i - 1]!;
      const overlapStart = snapToWordBoundary(
        prevChunk,
        prevChunk.length - chunkOverlap,
        "forward"
      );
      return prevChunk.slice(overlapStart) + chunk;
    });
  }

  /**
   * 对单个文本字符串进行 LLM 语义切分
   */
  async splitText(text: string): Promise<string[]> {
    const windows = this.splitIntoWindows(text);
    const allChunks: string[] = [];
    const { chunkSize } = this.config;
    console.log('开始切分');
    
    for (const window of windows) {
      const chunks = await this.splitWindow(window);
      allChunks.push(...chunks);
    }

    const finalChunks: string[] = [];
    for (const chunk of allChunks) {
      if (chunk.length <= chunkSize) {
        finalChunks.push(chunk);
      } else {
        for (let i = 0; i < chunk.length; i += chunkSize) {
          const sub = chunk.slice(i, i + chunkSize).trim();
          if (sub) finalChunks.push(sub);
        }
      }
    }

    return this.applyOverlap(this.greedyMerge(finalChunks));
  }

  /**
   * 接收文档，执行 LLM 语义切分，返回 LlamaIndex 兼容的 TextNode[]
   */
  async splitDocuments(docs: { text: string; id_?: string }[]): Promise<TextNode[]> {
    const nodes: TextNode[] = [];

    for (const doc of docs) {
      const chunks = await this.splitText(doc.text);
      chunks.forEach((chunk, i) => {
        const node = new TextNode({
          text: chunk,
          id_: `${doc.id_ || "doc"}-llm-${i}`,
        });
        nodes.push(node);
      });
    }

    return nodes;
  }
}

export {
  FixedSizeChunk,
  SemanticChunk,
  RecursiveChunk,
  LLMChunk,
  SentenceSplitter,
  TokenTextSplitter,
  SentenceWindowNodeParser,
};

export type {
  FixedSizeChunkConfig,
  SemanticChunkConfig,
  RecursiveChunkConfig,
  LLMChunkConfig,
};
