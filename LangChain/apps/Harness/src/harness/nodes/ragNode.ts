/**
 * ragNode - RAG 注入节点
 *
 * 在 memory 之后、Agent 之前执行。
 * 使用 RAG Pipeline 检索与当前问题相关的文档，
 * 注入到状态中，供后续 Agent 节点使用。
 *
 * 功能：
 *   1. 从 RAG Pipeline 检索相关文档（hybrid 模式）
 *   2. 构造 RAG 上下文文本（含来源和相关性分数）
 *   3. 注入到 state.ragContext 和 state.ragDocuments
 */

import { RAGPipeline } from "../../services/rag/pipeline.ts";

/**
 * 全局 RAG Pipeline 实例
 *
 * 可通过 setRAGInstance() 替换为自定义实例
 */
let ragInstance: RAGPipeline | null = null;

/**
 * 设置 RAG Pipeline 实例（用于依赖注入）
 */
export function setRAGInstance(rag: RAGPipeline): void {
  ragInstance = rag;
}

/**
 * 获取 RAG Pipeline 实例（懒加载）
 */
export function getRAGInstance(): RAGPipeline {
  if (!ragInstance) {
    ragInstance = new RAGPipeline();
  }
  return ragInstance;
}

/**
 * RAG 注入节点
 *
 * 输入：state.messages 中的用户消息
 * 输出：state.ragContext（检索到的文档拼接文本）
 *       state.ragDocuments（检索结果元数据列表）
 */
export async function ragNode(state: any): Promise<Partial<any>> {
  const query = state.messages?.[state.messages.length - 1]?.content || "";

  if (!query) {
    return {
      ragContext: null,
      ragDocuments: [],
      currentStep: "rag",
    };
  }

  const rag = getRAGInstance();

  // 1. 初始化 RAG Pipeline（首次调用时）
  try {
    await rag.initialize();
  } catch (error: any) {
    console.log(`[RagNode] initialize failed: ${error.message}`);
    return {
      ragContext: null,
      ragDocuments: [],
      currentStep: "rag",
    };
  }

  // 2. 检索相关文档（hybrid 模式：向量 + 关键词）
  let results: any[] = [];
  try {
    results = await rag.retrieve(query, "hybrid", 3);
  } catch (error: any) {
    console.log(`[RagNode] retrieve failed: ${error.message}`);
    results = [];
  }

  if (results.length === 0) {
    console.log(`[RagNode] no relevant documents found for: "${query.slice(0, 50)}"`);
    return {
      ragContext: null,
      ragDocuments: [],
      currentStep: "rag",
    };
  }

  // 3. 构造 RAG 上下文文本
  const ragContext = results
    .map((r, i) => {
      const source = r.document.metadata?.source || "unknown";
      const score = r.finalScore?.toFixed(3) || "N/A";
      const content = r.document.pageContent.slice(0, 500);
      return `[文档${i + 1}] (来源: ${source}, 相关度: ${score})\n${content}`;
    })
    .join("\n\n");

  // 4. 组织检索结果元数据
  const ragDocuments = results.map((r) => ({
    content: r.document.pageContent.slice(0, 200),
    score: r.finalScore,
    source: r.document.metadata?.source,
  }));

  console.log(`[RagNode] query="${query.slice(0, 50)}", docs=${results.length}, context=${ragContext.length} chars`);

  return {
    ragContext,
    ragDocuments,
    currentStep: "rag",
  };
}