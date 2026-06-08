/**
 * SemanticSplitter - 语义切分器
 *
 * 策略：先按段落/标题切分，再对过大的段落用语义相似度做二次切分
 * - 段落切分：双换行符、Markdown 标题、编号章节
 * - 语义切分：计算段落 embedding 相似度，在语义跳变处断开
 */

import { OpenAIEmbedding } from "@llamaindex/openai";
import { similarity } from "@llamaindex/core/embeddings";
import { Document, TextNode } from "@llamaindex/core/schema";

interface SplitterConfig {
  /** 语义断点阈值 (0~1)，越低越容易断开，推荐 0.65~0.75 */
  breakpointThreshold: number;
  /** 每个 chunk 最大字符数，超过此值强制切分 */
  maxChunkChars: number;
  /** embedding 模型 */
  model: string;
}

const DEFAULT_CONFIG: SplitterConfig = {
  breakpointThreshold: 0.7,
  maxChunkChars: 800,
  model: "text-embedding-v3",
};

class SemanticSplitter {
  private embedModel: OpenAIEmbedding;
  private config: SplitterConfig;

  constructor(config?: Partial<SplitterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embedModel = new OpenAIEmbedding({ model: this.config.model });
  }

  /** 按逻辑块切分（段落/标题/编号项） */
  private splitBlocks(text: string): string[] {
    // 1. 按 Markdown 标题切
    // 2. 按编号章节切（如 "1. 标题" "2. 标题"）
    // 3. 按双换行切（段落）
    // 4. 按单换行切（bullet 列表中的逐项）
    const blocks: string[] = [];
    const lines = text.split("\n");

    let current = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current) {
          blocks.push(current.trim());
          current = "";
        }
        continue;
      }

      // 标题行：以 # 开头、或 "数字. "、或 "❌ " 等标记
      // 注意：● 是 bullet 列表项，不是 section start（如 COSTAR 框架下的各个子项）
      const isSectionStart =
        /^#{1,6}\s/.test(trimmed) ||
        /^\d+\.\s/.test(trimmed)
        // /^[A-Z][\w\s]+类型/.test(trimmed) ||
        // /^技术\s/.test(trimmed) ||
        // /^适用场景/.test(trimmed) ||
        // /^核心原则/.test(trimmed) ||
        // /^最佳实践/.test(trimmed) ||
        // /^常见误区/.test(trimmed);

      if (isSectionStart && current) {
        blocks.push(current.trim());
        current = trimmed;
      } else {
        current += (current ? " " : "") + trimmed;
      }
    }
    if (current) blocks.push(current.trim());

    return blocks.filter((b) => b.length > 10); // 过滤太短的碎片
  }

  async splitDocuments(docs: Document[]): Promise<TextNode[]> {
    const nodes: TextNode[] = [];

    for (const doc of docs) {
      // 1. 按段落/标题切分成逻辑块
      const blocks = this.splitBlocks(doc.text);
      if (blocks.length === 0) {
        nodes.push(new Document({ text: doc.text }));
        continue;
      }

      console.log(`  📦 ${blocks.length} 个逻辑块`);

      // 2. 如果块数量少，直接返回
      if (blocks.length <= 3) {
        for (const b of blocks) {
          nodes.push(new Document({ text: b }));
        }
        continue;
      }

      // 3. 计算每个块的 embedding
      const embeddings: number[][] = [];
      const BATCH_SIZE = 10;
      for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
        const batch = blocks.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = await this.embedModel.getTextEmbeddings(batch);
        embeddings.push(...batchEmbeddings);
      }

      // 4. 在语义断点处合并或切分
      let startIdx = 0;
      for (let i = 1; i < embeddings.length; i++) {
        const sim = similarity(embeddings[i - 1]!, embeddings[i]!);

        // 检查当前累积 chunk 是否超过最大字符数
        const chunkText = blocks.slice(startIdx, i).join("\n");
        const willExceed =
          chunkText.length + blocks[i]!.length > this.config.maxChunkChars;

        if (sim < this.config.breakpointThreshold && sim < 0.85 && willExceed) {
          // 语义跳变 + 超过最大长度 → 切分
          nodes.push(
            new Document({ text: blocks.slice(startIdx, i).join("\n") })
          );
          startIdx = i;
        }
      }

      // 收尾
      nodes.push(
        new Document({ text: blocks.slice(startIdx).join("\n") })
      );
    }

    return nodes;
  }
}

export default SemanticSplitter;