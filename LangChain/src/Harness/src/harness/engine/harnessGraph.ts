/**
 * Harness Graph - 完整的 Harness 编排图（含 Memory + RAG + Output + Observability）
 *
 * 构建主图，编排所有 Agent，包含：
 *   - 任务路由（简单 vs 复杂）
 *   - Memory 注入（增强对话能力）
 *   - RAG 注入（增强知识检索）
 *   - 人机交互审批（危险操作）
 *   - 统一输出（存入 Memory）
 *   - 可观测性（Tracing + Metrics + Logger）
 *   - 错误处理
 *   - 中断/恢复支持
 */

import { z } from "zod";
import { StateGraph } from "./stateGraph.ts";
import { StateSchema } from "./state.ts";
import { START, END } from "./edge.ts";
import { MemoryCheckpointer } from "./stateGraph.ts";
import {
  routerNode,
  simpleAgentNode,
  reactAgentNode,
  plannerNode,
  supervisorNode,
  approvalNode,
  executeToolNode,
  errorNode,
  routeByTaskType,
  shouldContinue,
} from "./harnessNodes.ts";
import { memoryNode } from "../nodes/memoryNode.ts";
import { ragNode } from "../nodes/ragNode.ts";
import { outputNode } from "../nodes/outputNode.ts";
import { traceableNode } from "../observability/traceableNode.ts";

/**
 * 创建完整的 Harness 状态 Schema（含 Memory 字段）
 */
export function createHarnessStateSchema(): StateSchema {
  return new StateSchema()
    // 对话
    .addField("messages", z.array(z.any()), "append")

    // 执行追踪
    .addField("currentStep", z.string())
    .addField("iteration", z.number())
    .addField("status", z.enum(["idle", "running", "paused", "completed", "failed"]))

    // 任务分类
    .addField("taskType", z.enum(["simple", "complex"]).nullable())
    .addField("plan", z.any())
    .addField("reasoning", z.string().nullable())
    .addField("targetAgent", z.string().nullable())
    .addField("confidence", z.number().nullable())

    // Memory 上下文
    .addField("memoryContext", z.string().nullable())
    .addField("relevantKnowledge", z.array(z.any()), "append")

    // RAG 上下文
    .addField("ragContext", z.string().nullable())
    .addField("ragDocuments", z.array(z.any()), "append")

    // 工具执行
    .addField("toolCalls", z.array(z.any()), "append")
    .addField("toolResults", z.array(z.any()), "append")
    .addField("pendingAction", z.any())
    .addField("plannedTools", z.array(z.any()), "append")

    // 结果
    .addField("results", z.array(z.any()), "append")
    .addField("finalResponse", z.string().nullable())

    // 错误处理
    .addField("error", z.string().nullable())

    // 审批
    .addField("needsApproval", z.boolean().default(false))
    .addField("approvalStatus", z.enum(["pending", "approved", "rejected"]).nullable())

    // 配置
    .addField("maxIterations", z.number().default(5));
}

/**
 * 创建完整的 Harness 编排图（含 Memory + Output + Worker 编排）
 *
 * 图流程：
 *   START → router → memory → rag → conditional(rag)
 *                         ↓ simple
 *                    simpleAgent → output
 *                         ↓ complex
 *                    planner → supervisor → output
 *                    reactAgent → 循环 → output
 *                    approval → executeTool → output
 *                    error → END
 *
 * @param options - 图配置
 * @returns 编译后的可执行图
 */
export function createHarnessGraph(options?: {
  checkpointer?: any;
  maxIterations?: number | undefined;
}): any {
  const HarnessState = createHarnessStateSchema();

  // 所有节点包装 traceableNode（自动 Tracing + Metrics + Logger）
  const tRouter = traceableNode("router", routerNode);
  const tMemory = traceableNode("memory", memoryNode);
  const tRag = traceableNode("rag", ragNode);
  const tSimple = traceableNode("simpleAgent", simpleAgentNode);
  const tReact = traceableNode("reactAgent", reactAgentNode);
  const tPlanner = traceableNode("planner", plannerNode);
  const tSupervisor = traceableNode("supervisor", supervisorNode);
  const tApproval = traceableNode("approval", approvalNode);
  const tExecuteTool = traceableNode("executeTool", executeToolNode);
  const tOutput = traceableNode("output", outputNode);
  const tError = traceableNode("error", errorNode);

  const graph = new StateGraph(HarnessState)
    .addNode("router", tRouter, { description: "分析任务并确定路由" })
    .addNode("memory", tMemory, { description: "从三层记忆获取上下文" })
    .addNode("rag", tRag, { description: "从 RAG Pipeline 检索相关文档" })
    .addNode("simpleAgent", tSimple, { description: "处理简单任务" })
    .addNode("reactAgent", tReact, { description: "通过推理处理复杂任务" })
    .addNode("planner", tPlanner, { description: "将复杂任务拆解为子任务序列" })
    .addNode("supervisor", tSupervisor, { description: "编排执行 Worker Agent 子任务" })
    .addNode("approval", tApproval, {
      interruptAfter: true,
      description: "请求人工审批危险操作",
    })
    .addNode("executeTool", tExecuteTool, { description: "执行已审批的工具" })
    .addNode("output", tOutput, { description: "统一输出并存入记忆" })
    .addNode("error", tError, { description: "优雅处理错误" })

    // === 边 ===
    // START → router → memory → rag
    .addEdge(START, "router")
    .addEdge("router", "memory")
    .addEdge("memory", "rag")

    // rag → 基于任务类型条件路由
    .addConditionalEdges("rag", routeByTaskType)

    // 简单 Agent → 审批判断
    .addConditionalEdges("simpleAgent", simpleAgentRouter)

    // 复杂任务: planner → supervisor → 输出
    .addEdge("planner", "supervisor")
    .addConditionalEdges("supervisor", supervisorRouter)

    // 审批 → 工具执行 → 输出
    .addConditionalEdges("approval", approvalRouter)
    .addEdge("executeTool", "output")

    // ReAct Agent → 循环判断
    .addConditionalEdges("reactAgent", reactLoopRouter)

    // 输出 → END
    .addEdge("output", END)
    .addEdge("error", END);

  return graph.compile({
    checkpointer: options?.checkpointer ?? new MemoryCheckpointer(),
  });
}

// ==================== 条件路由函数 ====================

/**
 * simpleAgent 执行后路由：
 *   - 有错误 → error
 *   - 需要审批 → approval
 *   - 否则 → output
 */
function simpleAgentRouter(state: any): string {
  if (state.error) return "error";
  if (state.needsApproval) return "approval";
  return "output";
}

/**
 * approval 执行后路由：
 *   - 已批准 → executeTool
 *   - 已拒绝 → output（输出拒绝结果）
 */
function approvalRouter(state: any): string {
  if (state.approvalStatus === "approved") return "executeTool";
  return "output"; // rejected 或其他 → 直接输出
}

/**
 * reactAgent 循环路由：
 *   - 有错误 → error
 *   - 需要审批 → approval
 *   - 已完成 → output
 *   - 超过迭代限制 → output
 *   - 否则继续循环
 */
function reactLoopRouter(state: any): string {
  if (state.error) return "error";
  if (state.needsApproval) return "approval";
  // 检查最新的 result（results 是 append 模式，最新的在末尾）
  const latestResult = state.results?.[state.results.length - 1];
  if (latestResult?.type === "react_completed" || latestResult?.type === "direct_response") return "output";
  if ((state.iteration || 0) >= (state.maxIterations || 5)) return "output";
  return "reactAgent";
}

/**
 * supervisor 执行后路由：
 *   - 有错误 → error
 *   - 需要审批 → approval
 *   - 否则 → output
 */
function supervisorRouter(state: any): string {
  if (state.error) return "error";
  if (state.needsApproval) return "approval";
  return "output";
}

// ==================== 简化 Harness ====================

/**
 * 仅使用 simpleAgent 的简化 Harness（含 Memory）
 */
export function createSimpleHarnessGraph(): any {
  const HarnessState = new StateSchema()
    .addField("messages", z.array(z.any()), "append")
    .addField("currentStep", z.string())
    .addField("memoryContext", z.string().nullable())
    .addField("relevantKnowledge", z.array(z.any()), "append")
    .addField("ragContext", z.string().nullable())
    .addField("ragDocuments", z.array(z.any()), "append")
    .addField("results", z.array(z.any()), "append")
    .addField("finalResponse", z.string().nullable())
    .addField("status", z.enum(["idle", "running", "completed", "failed"]))
    .addField("error", z.string().nullable());

  const tMemory = traceableNode("memory", memoryNode);
  const tRag = traceableNode("rag", ragNode);
  const tAgent = traceableNode("simpleAgent", simpleAgentNode);
  const tOutput = traceableNode("output", outputNode);

  const graph = new StateGraph(HarnessState)
    .addNode("memory", tMemory)
    .addNode("rag", tRag)
    .addNode("agent", tAgent)
    .addNode("output", tOutput)
    .addEdge(START, "memory")
    .addEdge("memory", "rag")
    .addEdge("rag", "agent")
    .addEdge("agent", "output")
    .addEdge("output", END);

  return graph.compile();
}

/**
 * 仅使用 reactAgent 的 ReAct Harness（含 Memory）
 */
export function createReActHarnessGraph(maxIterations: number = 5): any {
  const HarnessState = new StateSchema()
    .addField("messages", z.array(z.any()), "append")
    .addField("currentStep", z.string())
    .addField("iteration", z.number())
    .addField("memoryContext", z.string().nullable())
    .addField("relevantKnowledge", z.array(z.any()), "append")
    .addField("ragContext", z.string().nullable())
    .addField("ragDocuments", z.array(z.any()), "append")
    .addField("results", z.array(z.any()), "append")
    .addField("finalResponse", z.string().nullable())
    .addField("toolCalls", z.array(z.any()), "append")
    .addField("status", z.enum(["idle", "running", "completed", "failed"]))
    .addField("error", z.string().nullable())
    .addField("maxIterations", z.number());

  const tMemory = traceableNode("memory", memoryNode);
  const tRag = traceableNode("rag", ragNode);
  const tAgent = traceableNode("reactAgent", async (state: any) => {
    return reactAgentNode({ ...state, maxIterations });
  });
  const tOutput = traceableNode("output", outputNode);

  const graph = new StateGraph(HarnessState)
    .addNode("memory", tMemory)
    .addNode("rag", tRag)
    .addNode("agent", tAgent)
    .addNode("output", tOutput)
    .addEdge(START, "memory")
    .addEdge("memory", "rag")
    .addEdge("rag", "agent")
    .addEdge("agent", "output")
    .addEdge("output", END);

  return graph.compile();
}

// ==================== 执行入口 ====================

/**
 * 通过 Harness 图执行任务
 */
export async function executeHarnessTask(
  input: string,
  options?: {
    threadId?: string | undefined;
    maxIterations?: number | undefined;
    checkpointer?: any;
  }
): Promise<{
  response: string;
  status: string;
  taskType?: string;
  toolCalls?: any[];
  interrupt?: InterruptRequest[];
  memoryContext?: string | null;
  ragContext?: string | null;
}> {
  const graph = createHarnessGraph({
    checkpointer: options?.checkpointer,
    maxIterations: options?.maxIterations,
  });

  const result = await graph.invoke(
    {
      messages: [{ role: "user", content: input }],
      taskType: null,
      plan: null,
      reasoning: null,
      targetAgent: null,
      confidence: null,
      memoryContext: null,
      relevantKnowledge: [],
      ragContext: null,
      ragDocuments: [],
      toolCalls: [],
      toolResults: [],
      results: [],
      currentStep: "",
      iteration: 0,
      status: "running",
      error: null,
      needsApproval: false,
      approvalStatus: null,
      maxIterations: options?.maxIterations ?? 5,
    },
    {
      configurable: {
        thread_id: options?.threadId ?? `thread-${Date.now()}`,
      },
    }
  );

  return {
    response: result.finalResponse || "",
    status: result.status,
    taskType: result.taskType,
    toolCalls: result.toolCalls,
    interrupt: result.__interrupt__,
    memoryContext: result.memoryContext,
    ragContext: result.ragContext,
  };
}

/**
 * 从中断恢复执行
 */
export async function resumeHarnessTask(
  threadId: string,
  approved: boolean,
  checkpointer?: any
): Promise<any> {
  const graph = createHarnessGraph({ checkpointer });

  return graph.invoke(
    Command.resume(approved),
    { configurable: { thread_id: threadId } }
  );
}

// 便捷重导出
export { StateGraph } from "./stateGraph.ts";
export { MemoryCheckpointer } from "./stateGraph.ts";
export { Command } from "./command.ts";
export { interrupt } from "./command.ts";

import { Command } from "./command.ts";
import type { InterruptRequest } from "./command.ts";

/**
 * 生产级 Harness 图入口 — 与 createHarnessGraph 相同
 *
 * 推荐在生产环境使用此函数名，语义更清晰。
 */
export const createProductionHarnessGraph = createHarnessGraph;

export default createHarnessGraph;