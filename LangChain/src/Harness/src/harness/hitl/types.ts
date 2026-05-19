/**
 * HITL Types - 人机交互类型定义
 */

import type { InterruptRequest } from "../engine/command.ts";

/**
 * 审批请求
 */
export interface ApprovalRequest {
  /** 请求 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  toolParams: Record<string, any>;
  /** 危险等级 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** 风险描述 */
  riskDescription: string;
  /** 请求时间 */
  timestamp: number;
  /** 上下文信息 */
  context?: Record<string, any> | undefined;
}

/**
 * 审批决策
 */
export interface ApprovalDecision {
  /** 请求 ID */
  requestId: string;
  /** 决策结果 */
  decision: "approved" | "rejected" | "modified";
  /** 审批人 */
  approver?: string;
  /** 修改后的参数（如果 decision 为 modified） */
  modifiedParams?: Record<string, any>;
  /** 审批备注 */
  comment?: string;
  /** 决策时间 */
  timestamp: number;
}

/**
 * 审批结果
 */
export interface ApprovalResult {
  approved: boolean;
  decision: ApprovalDecision;
  modifiedParams?: Record<string, any> | undefined;
}

/**
 * 危险工具定义
 */
export interface DangerousTool {
  /** 工具名称 */
  name: string;
  /** 危险等级 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** 风险描述 */
  riskDescription: string;
  /** 是否需要审批 */
  requiresApproval: boolean;
  /** 审批前置条件（可选） */
  approvalCondition?: ((params: Record<string, any>) => boolean) | undefined;
}

/**
 * 审批配置
 */
export interface ApprovalConfig {
  /** 是否启用审批 */
  enabled: boolean;
  /** 需要审批的工具列表 */
  dangerousTools: DangerousTool[];
  /** 自动批准的低风险工具 */
  autoApproveLowRisk: boolean;
  /** 审批超时时间（毫秒） */
  timeout: number;
}

/**
 * 默认危险工具配置
 */
export const DEFAULT_DANGEROUS_TOOLS: DangerousTool[] = [
  {
    name: "write_file",
    riskLevel: "high",
    riskDescription: "写入文件可能覆盖重要内容",
    requiresApproval: true,
  },
  {
    name: "file_edit",
    riskLevel: "high",
    riskDescription: "编辑文件可能破坏内容",
    requiresApproval: true,
  },
  {
    name: "bash",
    riskLevel: "critical",
    riskDescription: "执行 shell 命令可执行任意操作",
    requiresApproval: true,
  },
  {
    name: "delete",
    riskLevel: "critical",
    riskDescription: "删除操作不可恢复",
    requiresApproval: true,
  },
  {
    name: "send",
    riskLevel: "high",
    riskDescription: "发送消息可能泄露信息",
    requiresApproval: true,
  },
  {
    name: "http_request",
    riskLevel: "medium",
    riskDescription: "HTTP 请求可能访问敏感服务",
    requiresApproval: true,
  },
];

/**
 * 默认审批配置
 */
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  enabled: true,
  dangerousTools: DEFAULT_DANGEROUS_TOOLS,
  autoApproveLowRisk: false,
  timeout: 60000, // 1 minute
};

/**
 * 中断状态
 */
export interface InterruptState {
  /** 线程 ID */
  threadId: string;
  /** 当前节点 */
  currentNode: string;
  /** 待审批的请求 */
  pendingRequest: ApprovalRequest;
  /** 状态 */
  status: "pending" | "approved" | "rejected" | "modified" | "expired";
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}