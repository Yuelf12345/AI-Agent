/**
 * 文档分块器 (Chunker)
 * 
 * 负责：将长文档切分为小块，以便 Embedding 和向量检索
 * 
 * RAG 核心概念：
 *   文档通常很长（几千甚至几万字），直接 Embedding 整篇文档会导致：
 *   1. 向量丢失细节（"平均化"问题）
 *   2. 超出模型最大输入长度
 *   3. 检索精度差（无法定位到具体段落）
 *   
 *   分块 (Chunking) 是将长文档切分为合适大小的片段，
 *   每个片段独立 Embedding，使得检索可以精准匹配到具体内容。
 *   
 *   关键参数：
 *   - chunkSize: 每块的最大长度（字符数或 token 数）
 *   - chunkOverlap: 相邻块之间的重叠部分（避免语义断裂）
 *   
 *   分块策略按文档类型不同：
 *   - Markdown → 按 Header 拆分（保留结构）
 *   - 纯文本 → 递归字符拆分（通用）
 *   - 代码 → 按 AST 节点（函数/类级别）
 */

import { Document } from "@langchain/core/documents";
import {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
} from "@langchain/textsplitters";
import type { SupportedTextSplitterLanguage } from "@langchain/textsplitters";

/**
 * 分块策略类型
 */
export type ChunkStrategy = "recursive" | "markdown" | "code";

/**
 * 分块配置
 */
export interface ChunkConfig {
  strategy: ChunkStrategy;
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
  language?: SupportedTextSplitterLanguage;
}

/**
 * 默认分块配置（按文档类型）
 */
export const DEFAULT_CHUNK_CONFIGS = {
  markdown: {
    strategy: "markdown" as ChunkStrategy,
    chunkSize: 500,
    chunkOverlap: 50,
  },
  text: {
    strategy: "recursive" as ChunkStrategy,
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", ". ", " ", ""],
  },
  code: {
    strategy: "code" as ChunkStrategy,
    chunkSize: 1500,
    chunkOverlap: 100,
    language: "js" as SupportedTextSplitterLanguage,
  },
};

/**
 * 文档分块器
 */
export class DocumentChunker {
  private config: ChunkConfig;

  constructor(config: ChunkConfig) {
    this.config = config;
  }

  /**
   * 创建对应的 TextSplitter 实例
   */
  private createSplitter(): any {
    switch (this.config.strategy) {
      case "recursive":
        return new RecursiveCharacterTextSplitter({
          chunkSize: this.config.chunkSize,
          chunkOverlap: this.config.chunkOverlap,
          separators: this.config.separators || ["\n\n", "\n", ". ", " ", ""],
        });

      case "markdown":
        return new MarkdownTextSplitter();

      case "code":
        return RecursiveCharacterTextSplitter.fromLanguage(
          this.config.language || "js",
          {
            chunkSize: this.config.chunkSize,
            chunkOverlap: this.config.chunkOverlap,
          },
        );

      default:
        throw new Error(`Unknown chunk strategy: ${this.config.strategy}`);
    }
  }

  /**
   * 分块单篇文档
   */
  async split(doc: Document): Promise<Document[]> {
    const splitter = this.createSplitter();
    return await splitter.splitDocuments([doc]);
  }

  /**
   * 分块多篇文档
   */
  async splitMany(docs: Document[]): Promise<Document[]> {
    const allChunks: Document[] = [];
    for (const doc of docs) {
      const chunks = await this.split(doc);
      allChunks.push(...chunks);
    }
    return allChunks;
  }

  /**
   * 智能分块：根据文件类型自动选择策略
   */
  async smartSplit(doc: Document, filename?: string): Promise<Document[]> {
    const name = filename || (doc.metadata?.source as string) || "";

    if (name.endsWith(".md") || name.endsWith(".markdown")) {
      const chunker = new DocumentChunker(DEFAULT_CHUNK_CONFIGS.markdown);
      return await chunker.split(doc);
    }

    if (
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".js") ||
      name.endsWith(".jsx")
    ) {
      const chunker = new DocumentChunker({
        strategy: "code",
        chunkSize: 1500,
        chunkOverlap: 100,
        language: "js",
      });
      return await chunker.split(doc);
    }

    if (name.endsWith(".py")) {
      const chunker = new DocumentChunker({
        strategy: "code",
        chunkSize: 1500,
        chunkOverlap: 100,
        language: "python",
      });
      return await chunker.split(doc);
    }

    return await this.split(doc);
  }
}

export default DocumentChunker;