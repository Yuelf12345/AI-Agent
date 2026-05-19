/**
 * outputNode - 统一输出节点
 *
 * 负责：
 *   1. 从 results 中提取最终响应
 *   2. 将响应存入 Memory（长期记忆）
 *   3. 清理工作记忆
 *   4. 生成最终状态
 */

import { getMemoryInstance } from "./memoryNode.ts";

/**
 * 输出节点 - 统一处理最终响应
 */
export async function outputNode(state: any): Promise<Partial<any>> {
  // 1. 提取最终响应
  let response = "";

  if (state.finalResponse) {
    response = state.finalResponse;
  } else if (state.results?.length > 0) {
    // 从 results 数组中提取响应
    for (const r of state.results) {
      if (r.response) {
        response = r.response;
        break;
      }
      if (r.finalResponse) {
        response = r.finalResponse;
        break;
      }
      if (r.toolResult) {
        response = r.toolResult;
        break;
      }
    }
  }

  // 2. 存入 Memory（重要回复存入长期记忆）
  if (response && response.length > 20) {
    const memory = getMemoryInstance();
    try {
      await memory.add({
        id: `msg-assistant-${Date.now()}`,
        role: "assistant",
        content: response,
        importance: response.length > 100 ? 0.7 : 0.4,
        timestamp: new Date(),
      });
    } catch (error: any) {
      console.log(`[OutputNode] memory add failed: ${error.message}`);
    }

    // 清理工作记忆（推理过程不再需要）
    try {
      memory.clearWorking();
    } catch (error: any) {
      console.log(`[OutputNode] clear working memory failed: ${error.message}`);
    }
  }

  console.log(`[OutputNode] final response: ${response.slice(0, 100)} (${response.length} chars)`);

  return {
    finalResponse: response,
    status: "completed",
    currentStep: "output",
  };
}