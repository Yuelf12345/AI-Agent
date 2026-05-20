/**
 * Harness 节点 - 将现有 Agent 适配为 GraphNode
 *
 * 将已有的 Agent 实现包装为 StateGraph 可用的节点函数。
 */

import { Command, interrupt, RESUME_VALUE_KEY } from "./command.ts";
import { END } from "./edge.ts";
import { harnessToolRegistry } from "../tools/registry.ts";
import { SimpleAgent } from "../agents/simpleAgent.ts";
import { ReActAgent } from "../agents/reactAgent.ts";
import { Router } from "../agents/router.ts";
import { Planner } from "../agents/planner.ts";
import { Supervisor } from "../agents/supervisor.ts";
import { approvalGate } from "../hitl/approval.ts";

/**
 * 路由节点 - 任务分类
 *
 * 使用真实的 Router 类分析用户输入并确定：
 *   - taskType: "simple" | "complex"（来自 LLM 判断）
 *   - reasoning: 判断理由
 *   - targetAgent: 目标 Agent 名称
 *   - confidence: 置信度
 */
export async function routerNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) {
    return {
      taskType: "simple",
      reasoning: "无输入，默认简单任务",
      currentStep: "router",
    };
  }

  try {
    // 使用真实的 Router 类进行任务分类
    const router = new Router();
    const result = await router.route(lastMessage);

    console.log(`[RouterNode] taskType=${result.taskType}, reasoning=${result.reasoning}, confidence=${result.confidence}`);

    return {
      taskType: result.taskType,
      reasoning: result.reasoning,
      targetAgent: result.targetAgent,
      confidence: result.confidence,
      currentStep: "router",
    };
  } catch (error) {
    console.error("[RouterNode] 错误:", error);
    return {
      taskType: "complex",  // 错误时默认使用复杂模式（更安全）
      reasoning: `路由失败: ${error}`,
      currentStep: "router",
    };
  }
}

/**
 * 简单 Agent 节点 - 单次 LLM 调用（注入 Memory + RAG 上下文）
 *
 * 用于可以在一轮完成的简单任务。
 * 将 state.memoryContext 和 state.ragContext 注入到输入中，
 * 让 LLM 能够利用记忆和检索到的知识。
 */
export async function simpleAgentNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) {
    return {
      results: [{ type: "empty", response: "未提供输入" }],
      currentStep: "simpleAgent",
    };
  }

  // 构造增强输入：注入 Memory + RAG 上下文
  const enrichedInput = buildEnrichedInput(lastMessage, state);

  try {
    const agent = new SimpleAgent();
    const result = await agent.execute(enrichedInput);

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
 * ReAct Agent 节点 - 多步推理循环（注入 Memory + RAG 上下文）
 *
 * 用于需要多个推理步骤和工具调用的复杂任务。
 * 实现 Thought → Action → Observation 循环。
 * 将 state.memoryContext 和 state.ragContext 注入到输入中。
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

  // 构造增强输入：注入 Memory + RAG 上下文
  const enrichedInput = buildEnrichedInput(lastMessage, state);

  try {
    const agent = new ReActAgent({ maxIterations });
    const result = await agent.execute(enrichedInput);

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
 * 恢复模式：当 graph.invoke(Command.resume(value)) 恢复时，
 * resumeValue 通过 state.__resumeValue__ 传入。
 * 节点函数先检查 __resumeValue__，有值则跳过 interrupt() 调用。
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

  // 使用 ApprovalGate 检查是否需要审批
  const needsApprovalResult = approvalGate.needsApproval(
    pendingAction?.tool, pendingAction?.params || pendingAction?.parameters
  );

  if (!needsApprovalResult) {
    // 不需要审批，继续执行
    return { approvalStatus: "approved", needsApproval: false };
  }

  // ---- 恢复模式：检查 __resumeValue__ ----
  if (state[RESUME_VALUE_KEY] !== undefined) {
    const resumeValue = state[RESUME_VALUE_KEY];

    // 处理 ApprovalDecision 对象
    if (typeof resumeValue === "object" && resumeValue.decision) {
      if (resumeValue.decision === "approved") {
        return {
          approvalStatus: "approved",
          needsApproval: false,
          modifiedParams: resumeValue.modifiedParams,
          currentStep: "approval",
        };
      } else if (resumeValue.decision === "modified") {
        // 用户修改了参数并批准
        return {
          approvalStatus: "approved",
          needsApproval: false,
          modifiedParams: resumeValue.modifiedParams,
          currentStep: "approval",
        };
      }
      // 拒绝
      return {
        approvalStatus: "rejected",
        needsApproval: false,
        results: [{ type: "rejected", reason: resumeValue.comment || "用户拒绝审批" }],
        currentStep: "approval",
      };
    }

    // 处理简单布尔值
    if (resumeValue === true) {
      return {
        approvalStatus: "approved",
        needsApproval: false,
        currentStep: "approval",
      };
    }

    // 拒绝
    return {
      approvalStatus: "rejected",
      needsApproval: false,
      results: [{ type: "rejected", reason: "用户拒绝审批" }],
      currentStep: "approval",
    };
  }

  // ---- 新调用：触发中断 ----
  // 创建审批请求
  const approvalRequest = approvalGate.createRequest(
    pendingAction.tool || pendingAction?.tool,
    pendingAction.params || pendingAction?.parameters || {}
  );

  // 调用 interrupt 暂停并等待人工决策
  // interrupt() 抛出 InterruptSignal，后续代码不会执行
  interrupt({
    type: "approval_request",
    request: approvalRequest,
    question: `是否执行 ${pendingAction.tool} 操作？`,
    details: pendingAction,
    warning: approvalGate.getRiskLevel(pendingAction.tool) === "critical"
      ? "此操作可能会修改或删除关键文件"
      : "此操作需要确认",
  });

  // 此行不会执行，直到恢复时通过 __resumeValue__ 处理
  // interrupt() 抛出 InterruptSignal，理论上不会到达此处
  // 但 TypeScript 无法推断 throw 会中断控制流，所以需要兜底 return
  return { approvalStatus: "pending", currentStep: "approval" };
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
    const result = await harnessToolRegistry.invokeCompat({
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
 * 构造增强输入 - 将 Memory 和 RAG 上下文注入到用户输入中
 *
 * 格式：
 *   [记忆上下文]
 *   <memoryContext>
 *
 *   [知识检索]
 *   <ragContext>
 *
 *   [用户问题]
 *   <userMessage>
 *
 * 如果没有上下文，直接返回原始用户输入。
 */
function buildEnrichedInput(userMessage: string, state: any): string {
  const sections: string[] = [];

  if (state.memoryContext) {
    sections.push(`[记忆上下文]\n${state.memoryContext}`);
  }

  if (state.ragContext) {
    sections.push(`[知识检索]\n${state.ragContext}`);
  }

  if (state.relevantKnowledge?.length > 0) {
    const knowledge = state.relevantKnowledge
      .map((k: any) => `- (${k.source}, score: ${k.score?.toFixed(2) || "N/A"}) ${k.content}`)
      .join("\n");
    sections.push(`[相关知识]\n${knowledge}`);
  }

  if (sections.length === 0) {
    return userMessage;
  }

  sections.push(`[用户问题]\n${userMessage}`);

  return sections.join("\n\n");
}

/**
 * Planner 节点 - 将复杂任务拆解为子任务序列
 *
 * 调用 Planner.plan() 将用户输入拆解为多个子任务，
 * 每个子任务指定 assignedAgent、dependencies、params。
 */
export async function plannerNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) {
    return {
      plan: { subtasks: [], reasoning: "无输入" },
      currentStep: "planner",
    };
  }

  // 构造增强输入：注入 Memory + RAG 上下文
  const enrichedInput = buildEnrichedInput(lastMessage, state);

  try {
    const planner = new Planner();
    const plan = await planner.plan(enrichedInput);

    console.log(`[PlannerNode] 生成 ${plan.subtasks.length} 个子任务, reasoning=${plan.reasoning}`);

    return {
      plan,
      currentStep: "planner",
    };
  } catch (error) {
    console.error("[PlannerNode] 错误:", error);
    return {
      plan: { subtasks: [], reasoning: `规划失败: ${error}` },
      error: String(error),
      currentStep: "planner",
    };
  }
}

/**
 * Supervisor 节点 - 按依赖顺序编排执行子任务
 *
 * 调用 Supervisor.execute(subtasks) 按依赖顺序执行所有子任务，
 * 每个子任务由对应的 Worker Agent 完成。
 * 汇总所有子任务结果，生成最终响应。
 */
export async function supervisorNode(state: any): Promise<Partial<any>> {
  const subtasks = state.plan?.subtasks || [];

  if (subtasks.length === 0) {
    return {
      results: [{ type: "empty_plan", response: "无法拆解任务，请直接描述需求" }],
      finalResponse: "无法拆解任务，请直接描述需求",
      currentStep: "supervisor",
    };
  }

  try {
    const supervisor = new Supervisor({ maxRetries: 2 });
    const taskResults = await supervisor.execute(subtasks);

    // 汇总所有子任务结果
    const completedResults = taskResults.filter(r => r.success);
    const failedResults = taskResults.filter(r => !r.success);

    const summary = completedResults
      .map((r: any) => {
        const agent = r.data?.agent || "unknown";
        const response = r.data?.response || "完成";
        return `[${agent}] ${response}`;
      })
      .join("\n");

    const failureSummary = failedResults.length > 0
      ? `\n\n失败的任务:\n${failedResults.map((r: any) => `- ${r.taskId}: ${r.error}`).join("\n")}`
      : "";

    const finalResponse = `任务编排结果:\n${summary}${failureSummary}`;

    console.log(`[SupervisorNode] 完成: ${completedResults.length}/${taskResults.length} 成功`);

    return {
      results: taskResults,
      finalResponse,
      currentStep: "supervisor",
    };
  } catch (error) {
    console.error("[SupervisorNode] 错误:", error);
    return {
      results: [],
      error: String(error),
      currentStep: "supervisor",
    };
  }
}

/**
 * 条件路由 - 根据任务类型路由
 */
export function routeByTaskType(state: any): string {
  if (state.taskType === "simple") {
    return "simpleAgent";
  }
  if (state.taskType === "complex") {
    return "planner";  // 复杂任务 → 先规划再编排（而非直接 ReAct）
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