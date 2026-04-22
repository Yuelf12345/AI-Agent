import type { LongTermMemoryEntry, Note } from '../../types/index.js';
import { config } from '../../config/index.js';

/**
 * 长期记忆管理器
 * 管理向量数据库（Chroma）的交互
 */
export class LongTermMemoryManager {
  private collectionName = 'notes';
  private initialized = false;

  // TODO: 注入 Chroma 客户端
  // private chromaClient: ChromaClient;
  // private collection: Collection;

  /**
   * 初始化向量数据库连接
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // TODO: 初始化 Chroma 客户端
    // const { ChromaClient } = await import('chromadb');
    // this.chromaClient = new ChromaClient({
    //   path: `http://${config.storage.chroma.host}:${config.storage.chroma.port}`
    // });
    // this.collection = await this.chromaClient.getOrCreateCollection({
    //   name: this.collectionName,
    //   metadata: { description: 'Personal knowledge notes' }
    // });

    this.initialized = true;
    console.log('[LongTermMemory] Initialized (Chroma integration pending)');
  }

  /**
   * 添加笔记到向量索引
   */
  async addNote(note: Note): Promise<string> {
    await this.init();

    const entry: LongTermMemoryEntry = {
      id: note.id,
      content: note.content,
      metadata: {
        type: 'note',
        source_id: note.id,
        created_at: note.created_at,
        tags: note.tags,
        title: note.title,
      },
    };

    // TODO: 调用 Embedding 模型生成向量
    // const embedding = await this.getEmbedding(note.content);
    // await this.collection.add({
    //   ids: [entry.id],
    //   embeddings: [embedding],
    //   documents: [entry.content],
    //   metadatas: [entry.metadata]
    // });

    console.log('[LongTermMemory] Note added (embedding pending):', note.id);
    return entry.id;
  }

  /**
   * 语义检索
   */
  async search(
    query: string,
    options?: {
      topK?: number;
      threshold?: number;
      tags?: string[];
    }
  ): Promise<LongTermMemoryEntry[]> {
    await this.init();

    const topK = options?.topK || config.memory.longTermMemory.topK;
    const threshold = options?.threshold || config.memory.longTermMemory.threshold;

    // TODO: 实现实际的向量检索
    // const queryEmbedding = await this.getEmbedding(query);
    // const results = await this.collection.query({
    //   queryEmbeddings: [queryEmbedding],
    //   nResults: topK,
    //   where: options?.tags ? { tags: { $in: options.tags } } : undefined
    // });

    console.log('[LongTermMemory] Search (vector retrieval pending):', query);
    return [];
  }

  /**
   * 获取 Embedding 向量
   */
  private async getEmbedding(text: string): Promise<number[]> {
    // TODO: 调用 Ollama 或 OpenAI Embedding API
    // const response = await this.embeddingModel.embed(text);
    // return response;
    
    // 占位：返回零向量
    return new Array(768).fill(0);
  }

  /**
   * 删除笔记向量
   */
  async deleteNote(noteId: string): Promise<void> {
    await this.init();

    // TODO: 从 Chroma 删除
    // await this.collection.delete({ ids: [noteId] });

    console.log('[LongTermMemory] Note deleted:', noteId);
  }

  /**
   * 更新笔记向量
   */
  async updateNote(note: Note): Promise<void> {
    await this.deleteNote(note.id);
    await this.addNote(note);
  }

  /**
   * 应用时间衰减权重
   */
  applyTimeDecay(entries: LongTermMemoryEntry[]): LongTermMemoryEntry[] {
    const decayFactor = config.memory.longTermMemory.decayFactor;
    const now = new Date();

    return entries.map(entry => {
      const age = Math.floor(
        (now.getTime() - new Date(entry.metadata.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      // 时间衰减评分
      const decayScore = Math.pow(decayFactor, age);
      
      return {
        ...entry,
        // 这里可以添加评分字段
      };
    });
  }

  /**
   * 混合检索（向量 + BM25）
   */
  async hybridSearch(
    query: string,
    options?: {
      vectorWeight?: number;
      bm25Weight?: number;
      topK?: number;
    }
  ): Promise<LongTermMemoryEntry[]> {
    const vectorWeight = options?.vectorWeight || 0.7;
    const bm25Weight = options?.bm25Weight || 0.3;
    const topK = options?.topK || 10;

    // TODO: 实现 BM25 检索
    // const vectorResults = await this.search(query, { topK });
    // const bm25Results = await this.bm25Search(query, topK);
    // const fused = this.weightedFuse(vectorResults, bm25Results, vectorWeight, bm25Weight);

    console.log('[LongTermMemory] Hybrid search (BM25 pending):', query);
    return [];
  }
}

export default LongTermMemoryManager;
