/**
 * Harness 节点 - 将现有 Agent 适配为 GraphNode
 *
 * 将已有的 Agent 实现包装为 StateGraph 可用的节点函数。
 */

import { Command, interrupt } from "./command.ts";
import { END } from "./edge.ts";
import { toolRegistry } from "../tools/registry.ts";
import { SimpleAgent } from "../agents/simpleAgent.ts";
import { ReActAgent } from "../agents/reactAgent.ts";
import { MainAgent } from "../agents/mainAgent.ts";

/**
 * 路由节点 - 任务分类
 *
 * 分析用户输入并确定：
 *   - taskType: "simple" | "complex"
 *   - plan: 来自 MainAgent 的执行计划
 */
export async function routerNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) {
    return {
      taskType: "simple",
      currentStep: "router",
    };
  }

  try {
    const agent = new MainAgent();
    // analyzeTask 是私有方法，使用 execute 替代
    const result = await agent.execute(lastMessage);

    return {
      taskType: "simple", // 默认简化处理
      plan: result,
      currentStep: "router",
    };
  } catch (error) {
    console.error("[RouterNode] 错误:", error);
    return {
      taskType: "simple",  // 错误时默认使用简单模式
      error: String(error),
      currentStep: "router",
    };
  }
}

/**
 * 简单 Agent 节点 - 单次 LLM 调用
 *
 * 用于可以在一轮完成的简单任务。
 * 返回直接响应或工具调用结果。
 */
export async function simpleAgentNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) {
    return {
      results: [{ type: "empty", response: "未提供输入" }],
      currentStep: "simpleAgent",
    };
  }

  try {
    const agent = new SimpleAgent();
    const result = await agent.execute(lastMessage);

    return {
      results: [result],
      currentStep: "simpleAgent",
    };
  } catch (error) {
    console.error("[SimpleAgentNode] 错误:", error);
    return {
      results: [],
      error: String(error),
      currentStep: "simpleAgent",
    };
  }
}

/**
 * ReAct Agent 节点 - 多步推理循环
 *
 * 用于需要多个推理步骤和工具调用的复杂任务。
 * 实现 Thought → Action → Observation 循环。
 */
export async function reactAgentNode(state: any): Promise<Partial<any> | Command> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";
  const maxIterations = state.maxIterations || 5;

  if (!lastMessage) {
    return {
      results: [{ type: "empty", response: "未提供输入" }],
      currentStep: "reactAgent",
    };
  }

  try {
    const agent = new ReActAgent({ maxIterations });
    const result = await agent.execute(lastMessage);

    // 检查是否达到最大迭代次数
    if (result.type === "react_max_iterations") {
      return {
        results: [result],
        finalResponse: result.finalResponse,
        currentStep: "reactAgent",
      };
    }

    return {
      results: [result],
      toolCalls: result.history?.map((h: any) => ({
        tool: h.action,
        params: h.actionParams,
        observation: h.observation,
      })) ?? [],
      currentStep: "reactAgent",
    };
  } catch (error) {
    console.error("[ReActAgentNode] 错误:", error);
    return {
      results: [],
      error: String(error),
      currentStep: "reactAgent",
    };
  }
}

/**
 * 审批节点 - 人机交互检查点
 *
 * 在危险操作前暂停执行。
 * 向用户展示计划的操作并等待审批。
 *
 * 使用方式：在图中添加此节点并设置 { interruptAfter: true }
 */
export async function approvalNode(state: any): Promise<Partial<any> | Command> {
  // 获取需要审批的最后一次工具调用
  const lastToolCall = state.toolCalls?.[state.toolCalls.length - 1];
  const pendingAction = state.pendingAction || lastToolCall;

  // 没有待处理操作，跳过审批
  if (!pendingAction) {
    return new Command({ goto: END });
  }

  // 检查此工具是否需要审批
  const dangerousTools = ["file_write", "file_edit", "bash", "delete", "send"];
  const needsApproval = dangerousTools.includes(pendingAction?.tool);

  if (!needsApproval) {
    // 不需要审批，继续执行
    return new Command({ goto: "executeTool" });
  }

  // 调用 interrupt 暂停并等待人工决策
  const decision = interrupt({
    type: "approval",
    question: `是否执行 ${pendingAction.tool} 操作？`,
    details: pendingAction,
    warning: "此操作可能会修改或删除文件",
  });

  // 此行不会执行，直到恢复
  // decision 变量将是恢复传入的值（true/false）
  if (decision === true) {
    return new Command({ goto: "executeTool" });
  } else {
    return {
      status: "rejected",
      results: [{ type: "rejected", reason: "用户拒绝审批" }],
      currentStep: "approval",
    };
  }
}

/**
 * 工具执行节点 - 实际执行已审批的工具
 */
export async function executeToolNode(state: any): Promise<Partial<any>> {
  const lastToolCall = state.toolCalls?.[state.toolCalls.length - 1];

  if (!lastToolCall) {
    return {
      results: [{ type: "no_tool", response: "没有可执行的工具" }],
      currentStep: "executeTool",
    };
  }

  try {
    const result = await toolRegistry.invoke({
      name: lastToolCall.tool,
      args: lastToolCall.params || {},
    });

    return {
      toolResults: [result],
      results: [{ type: "tool_result", tool: lastToolCall.tool, result }],
      currentStep: "executeTool",
    };
  } catch (error) {
    return {
      error: String(error),
      results: [{ type: "error", tool: lastToolCall.tool, error: String(error) }],
      currentStep: "executeTool",
    };
  }
}

/**
 * 错误处理节点 - 优雅处理错误
 */
export async function errorNode(state: any): Promise<Partial<any>> {
  const error = state.error || "未知错误";

  console.error("[ErrorNode] 处理错误:", error);

  return {
    status: "failed",
    error: String(error),
    results: [{
      type: "error",
      message: "任务执行失败",
      details: error,
    }],
    currentStep: "error",
  };
}

/**
 * 条件路由 - 根据任务类型路由
 */
export function routeByTaskType(state: any): string {
  if (state.taskType === "simple") {
    return "simpleAgent";
  }
  if (state.taskType === "complex") {
    return "reactAgent";
  }
  // 默认回退
  return "simpleAgent";
}

/**
 * 条件路由 - ReAct 循环的继续或结束判断
 */
export function shouldContinue(state: any): string {
  // 检查是否有错误
  if (state.error) {
    return "error";
  }

  // 检查是否需要审批
  if (state.needsApproval) {
    return "approval";
  }

  // 检查迭代限制
  const maxIterations = state.maxIterations || 5;
  if ((state.iteration || 0) >= maxIterations) {
    return END;
  }

  // 检查任务是否完成（已有最终响应）
  if (state.results?.[0]?.type === "react_completed") {
    return END;
  }

  // 继续循环
  return "reactAgent";
}

/**
 * 条件路由 - 工具执行后的路由
 */
export function afterToolExecution(state: any): string {
  // 如果有错误
  if (state.error) {
    return "error";
  }

  // 如果还有更多工具需要执行
  const executedCount = state.toolCalls?.length || 0;
  const totalTools = state.plannedTools?.length || 0;

  if (executedCount < totalTools) {
    return "reactAgent";  // 继续执行下一个工具
  }

  // 完成
  return END;
}

export default {
  routerNode,
  simpleAgentNode,
  reactAgentNode,
  approvalNode,
  executeToolNode,
  errorNode,
  routeByTaskType,
  shouldContinue,
  afterToolExecution,
};