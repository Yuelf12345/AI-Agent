/**
 * Harness Graph - 完整的 Harness 编排图
 *
 * 构建主图，编排所有 Agent，包含：
 *   - 任务路由（简单 vs 复杂）
 *   - 人机交互审批（危险操作）
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
  approvalNode,
  executeToolNode,
  errorNode,
  routeByTaskType,
  shouldContinue,
} from "./harnessNodes.ts";

/**
 * 创建默认的 Harness 状态 Schema
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
 * 创建完整的 Harness 编排图
 *
 * 图流程：
 *   START → router → [simpleAgent / reactAgent] → END
 *                    ↓
 *              (仅复杂任务)
 *                    ↓
 *              approval → executeTool → reactAgent
 *                    ↓
 *              error → END
 *
 * @param options - 图配置
 * @returns 编译后的可执行图
 */
export function createHarnessGraph(options?: {
  checkpointer?: any;
  maxIterations?: number | undefined;
}): any {
  // 1. 创建状态 Schema
  const HarnessState = createHarnessStateSchema();

  // 2. 构建图
  const graph = new StateGraph(HarnessState)
    // 路由器 - 确定任务类型
    .addNode("router", routerNode, { description: "分析任务并确定路由" })

    // 简单 Agent - 单轮任务
    .addNode("simpleAgent", simpleAgentNode, { description: "处理简单任务" })

    // ReAct Agent - 多步复杂任务
    .addNode("reactAgent", reactAgentNode, { description: "通过推理处理复杂任务" })

    // 审批 - 人机交互（危险操作审批）
    .addNode("approval", approvalNode, {
      interruptAfter: true,
      description: "请求人工审批危险操作",
    })

    // 工具执行 - 实际运行已审批的工具
    .addNode("executeTool", executeToolNode, { description: "执行已审批的工具" })

    // 错误处理
    .addNode("error", errorNode, { description: "优雅处理错误" })

    // 从 START 开始的边
    .addEdge(START, "router")

    // 基于任务类型的条件路由
    .addConditionalEdges("router", routeByTaskType)

    // 简单 Agent 流到 END
    .addEdge("simpleAgent", END)

    // ReAct Agent 有条件延续
    .addConditionalEdges("reactAgent", shouldContinue)

    // 审批流程
    .addEdge("approval", "executeTool")
    .addEdge("executeTool", "reactAgent")  // 工具执行后继续

    // 错误流程
    .addEdge("error", END);

  // 3. 使用 checkpointer 编译
  return graph.compile({
    checkpointer: options?.checkpointer ?? new MemoryCheckpointer(),
  });
}

/**
 * 仅使用 simpleAgent 的简化 Harness
 *
 * @returns 仅使用 simpleAgent 的图
 */
export function createSimpleHarnessGraph(): any {
  const HarnessState = new StateSchema()
    .addField("messages", z.array(z.any()), "append")
    .addField("currentStep", z.string())
    .addField("results", z.array(z.any()), "append")
    .addField("status", z.enum(["idle", "running", "completed", "failed"]))
    .addField("error", z.string().nullable());

  const graph = new StateGraph(HarnessState)
    .addNode("agent", simpleAgentNode)
    .addEdge(START, "agent")
    .addEdge("agent", END);

  return graph.compile();
}

/**
 * 仅使用 reactAgent 的 ReAct Harness
 *
 * @param maxIterations - 最大推理迭代次数
 * @returns 仅使用 reactAgent 的图
 */
export function createReActHarnessGraph(maxIterations: number = 5): any {
  const HarnessState = new StateSchema()
    .addField("messages", z.array(z.any()), "append")
    .addField("currentStep", z.string())
    .addField("iteration", z.number())
    .addField("results", z.array(z.any()), "append")
    .addField("toolCalls", z.array(z.any()), "append")
    .addField("status", z.enum(["idle", "running", "completed", "failed"]))
    .addField("error", z.string().nullable())
    .addField("maxIterations", z.number());

  const graph = new StateGraph(HarnessState)
    .addNode("agent", async (state: any) => {
      return reactAgentNode({ ...state, maxIterations });
    })
    .addEdge(START, "agent")
    .addEdge("agent", END);

  return graph.compile();
}

/**
 * 通过 Harness 图执行任务
 *
 * @param input - 用户输入消息
 * @param options - 执行选项
 * @returns 包含响应和元数据的结果
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

  // 提取响应
  let response = "";
  if (result.finalResponse) {
    response = result.finalResponse;
  } else if (result.results?.[0]?.response) {
    response = result.results[0].response;
  } else if (result.results?.[0]?.finalResponse) {
    response = result.results[0].finalResponse;
  }

  return {
    response,
    status: result.status,
    taskType: result.taskType,
    toolCalls: result.toolCalls,
    interrupt: result.__interrupt__,
  };
}

/**
 * 从中断恢复执行
 *
 * @param threadId - 来自中断响应的线程 ID
 * @param approved - 操作是否被批准
 * @param checkpointer - 可选的检查点器
 * @returns 恢复结果
 */
export async function resumeHarnessTask(
  threadId: string,
  approved: boolean,
  checkpointer?: any
): Promise<any> {
  const graph = createHarnessGraph({ checkpointer });

  const { Command } = await import("./command.ts");

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

// 需要导入 InterruptRequest 类型用于 executeHarnessTask 的返回类型
import type { InterruptRequest } from "./command.ts";

export default createHarnessGraph;