/**
 * ApprovalGate - 人机交互审批门控
 *
 * 为危险工具提供审批门控功能：
 * 1. 检测工具是否需要审批
 * 2. 生成审批请求
 * 3. 等待人工审批
 * 4. 根据审批结果执行或拒绝
 */

import {
  type ApprovalRequest,
  type ApprovalDecision,
  type ApprovalResult,
  type ApprovalConfig,
  type DangerousTool,
  type InterruptState,
  DEFAULT_APPROVAL_CONFIG,
} from "./types.ts";
import { interrupt } from "../engine/command.ts";

/**
 * 审批请求队列（内存存储）
 */
class ApprovalQueue {
  private pending: Map<string, InterruptState> = new Map();

  /**
   * 添加待审批请求
   */
  add(state: InterruptState): void {
    this.pending.set(state.threadId, state);
  }

  /**
   * 获取待审批请求
   */
  get(threadId: string): InterruptState | undefined {
    return this.pending.get(threadId);
  }

  /**
   * 更新审批状态
   */
  update(threadId: string, status: InterruptState["status"]): void {
    const state = this.pending.get(threadId);
    if (state) {
      state.status = status;
    }
  }

  /**
   * 移除已完成的请求
   */
  remove(threadId: string): void {
    this.pending.delete(threadId);
  }

  /**
   * 获取所有待审批请求
   */
  getAllPending(): InterruptState[] {
    return Array.from(this.pending.values()).filter(
      (s) => s.status === "pending"
    );
  }

  /**
   * 清理过期请求
   */
  cleanup(): void {
    const now = Date.now();
    for (const [threadId, state] of this.pending) {
      if (state.expiresAt < now) {
        state.status = "expired";
        this.pending.delete(threadId);
      }
    }
  }
}

/**
 * 审批门控
 *
 * 使用示例：
 * ```typescript
 * const gate = new ApprovalGate();
 *
 * // 在 Agent 执行工具前检查
 * const request = gate.createRequest("write_file", { filePath: "/etc/passwd", content: "..." });
 * if (gate.needsApproval(request)) {
 *   const result = await gate.requestApproval(request, "thread-123");
 *   if (!result.approved) {
 *     throw new Error("操作被拒绝");
 *   }
 * }
 * ```
 */
export class ApprovalGate {
  private config: ApprovalConfig;
  private queue: ApprovalQueue;
  private toolMap: Map<string, DangerousTool>;

  constructor(config: Partial<ApprovalConfig> = {}) {
    this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
    this.queue = new ApprovalQueue();
    this.toolMap = new Map();

    // 构建工具查找表
    for (const tool of this.config.dangerousTools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  /**
   * 检查工具是否需要审批
   */
  needsApproval(toolName: string, params?: Record<string, any>): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const tool = this.toolMap.get(toolName);
    if (!tool) {
      return false;
    }

    // 检查是否有审批条件
    if (tool.approvalCondition && params) {
      return tool.approvalCondition(params);
    }

    return tool.requiresApproval;
  }

  /**
   * 获取工具的危险等级
   */
  getRiskLevel(toolName: string): DangerousTool["riskLevel"] | undefined {
    return this.toolMap.get(toolName)?.riskLevel;
  }

  /**
   * 创建审批请求
   */
  createRequest(
    toolName: string,
    toolParams: Record<string, any>,
    context?: Record<string, any>
  ): ApprovalRequest {
    const tool = this.toolMap.get(toolName);
    const riskLevel = tool?.riskLevel || "low";

    return {
      id: `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      toolName,
      toolParams,
      riskLevel,
      riskDescription: tool?.riskDescription || "未知风险",
      timestamp: Date.now(),
      context,
    };
  }

  /**
   * 请求审批（使用 interrupt 暂停执行）
   *
   * @param request 审批请求
   * @param threadId 线程 ID（用于恢复）
   * @returns 审批结果
   */
  async requestApproval(
    request: ApprovalRequest,
    threadId: string
  ): Promise<ApprovalResult> {
    // 检查是否自动批准低风险
    if (
      this.config.autoApproveLowRisk &&
      request.riskLevel === "low"
    ) {
      return {
        approved: true,
        decision: {
          requestId: request.id,
          decision: "approved",
          timestamp: Date.now(),
        },
      };
    }

    // 使用 interrupt 暂停，等待人工审批
    const decision = interrupt({
      type: "approval_request",
      request,
      threadId,
      timeout: this.config.timeout,
    });

    // decision 是从外部传入的审批结果
    return this.processDecision(request, decision);
  }

  /**
   * 处理审批决策
   */
  private processDecision(
    request: ApprovalRequest,
    decision: ApprovalDecision | boolean
  ): ApprovalResult {
    // 处理布尔值（简单批准/拒绝）
    if (typeof decision === "boolean") {
      return {
        approved: decision,
        decision: {
          requestId: request.id,
          decision: decision ? "approved" : "rejected",
          timestamp: Date.now(),
        },
      };
    }

    // 处理完整决策对象
    return {
      approved: decision.decision === "approved",
      decision,
      modifiedParams: decision.modifiedParams,
    };
  }

  /**
   * 同步请求审批（用于 StateGraph 节点）
   *
   * 此方法不实际调用 interrupt，而是返回需要中断的信号
   * 由 StateGraph 处理中断逻辑
   */
  createInterruptState(
    request: ApprovalRequest,
    threadId: string,
    currentNode: string
  ): InterruptState {
    const state: InterruptState = {
      threadId,
      currentNode,
      pendingRequest: request,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.timeout,
    };

    this.queue.add(state);
    return state;
  }

  /**
   * 处理恢复请求
   */
  async handleResume(
    threadId: string,
    resumeValue: ApprovalDecision | boolean
  ): Promise<ApprovalResult> {
    const state = this.queue.get(threadId);
    if (!state) {
      throw new Error(`未找到线程 ${threadId} 的审批请求`);
    }

    const result = this.processDecision(state.pendingRequest, resumeValue);

    // 更新状态
    this.queue.update(
      threadId,
      result.approved
        ? result.modifiedParams
          ? "modified"
          : "approved"
        : "rejected"
    );

    return result;
  }

  /**
   * 获取待审批列表
   */
  getPendingApprovals(): InterruptState[] {
    this.queue.cleanup();
    return this.queue.getAllPending();
  }

  /**
   * 批准请求
   */
  approve(threadId: string, comment?: string): void {
    this.queue.update(threadId, "approved");
  }

  /**
   * 拒绝请求
   */
  reject(threadId: string, comment?: string): void {
    this.queue.update(threadId, "rejected");
  }

  /**
   * 修改并批准请求
   */
  modify(threadId: string, modifiedParams: Record<string, any>): void {
    const state = this.queue.get(threadId);
    if (state) {
      state.pendingRequest.toolParams = modifiedParams;
      this.queue.update(threadId, "modified");
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ApprovalConfig>): void {
    this.config = { ...this.config, ...config };

    // 重建工具查找表
    this.toolMap.clear();
    for (const tool of this.config.dangerousTools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ApprovalConfig {
    return { ...this.config };
  }

  /**
   * 启用/禁用审批
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * 全局审批门控单例
 */
export const approvalGate = new ApprovalGate();

/**
 * 便捷函数：检查工具是否需要审批
 */
export function needsApproval(toolName: string, params?: Record<string, any>): boolean {
  return approvalGate.needsApproval(toolName, params);
}

/**
 * 便捷函数：请求审批
 */
export async function requestApproval(
  request: ApprovalRequest,
  threadId: string
): Promise<ApprovalResult> {
  return approvalGate.requestApproval(request, threadId);
}