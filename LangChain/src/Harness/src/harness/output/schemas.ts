/**
 * Structured Output Schemas - 结构化输出 Schema 定义
 *
 * 使用 Zod 定义每个 Agent 的输出 Schema，
 * 配合 OpenAI response_format 实现可靠的 JSON 输出。
 */

import { z } from "zod";

/**
 * SimpleAgent 输出 Schema
 */
export const SimpleAgentSchema = z.object({
  thinking: z.string().describe("你的推理和分析过程"),
  needTool: z.boolean().describe("是否需要调用工具"),
  toolName: z.string().optional().describe("工具名称（如果 needTool 为 true）"),
  toolParams: z.record(z.string(), z.any()).optional().describe("工具参数字典"),
  response: z.string().describe("给用户的最终回复"),
});

/**
 * SimpleAgent 输出类型
 */
export type SimpleAgentOutput = z.infer<typeof SimpleAgentSchema>;

/**
 * ReActAgent 输出 Schema
 */
export const ReActAgentSchema = z.object({
  thought: z.string().describe("当前迭代的思考过程"),
  action: z.string().describe("要执行的工具名称，或 'finish' 表示完成"),
  actionParams: z.record(z.string(), z.any()).describe("工具参数字典"),
  response: z.string().optional().describe("最终回复（仅当 action 为 'finish' 时需要）"),
});

/**
 * ReActAgent 输出类型
 */
export type ReActAgentOutput = z.infer<typeof ReActAgentSchema>;

/**
 * MainAgent 子任务 Schema
 */
export const SubTaskSchema = z.object({
  id: z.string().describe("子任务 ID"),
  description: z.string().describe("子任务描述"),
  assignedTo: z.string().describe("分配给的 Worker 名称"),
  params: z.record(z.string(), z.any()).optional().describe("任务参数"),
  status: z.enum(["pending", "running", "completed", "failed"]).describe("任务状态"),
});

/**
 * MainAgent 执行计划 Schema
 */
export const MainAgentSchema = z.object({
  thinking: z.string().describe("任务分析过程"),
  needSplit: z.boolean().describe("是否需要拆分为子任务"),
  subtasks: z.array(SubTaskSchema).describe("子任务列表"),
  directResponse: z.string().optional().describe("如果不拆解，直接回复用户的内容"),
});

/**
 * MainAgent 输出类型
 */
export type MainAgentOutput = z.infer<typeof MainAgentSchema>;

/**
 * 手动构建 JSON Schema（用于 OpenAI response_format）
 *
 * Zod v4 不支持 .json() 方法，因此手动构建 OpenAI 兼容的 JSON Schema
 */

/** SimpleAgent 的 OpenAI JSON Schema */
export function getSimpleAgentJsonSchema(): object {
  return {
    type: "object",
    properties: {
      thinking: { type: "string", description: "你的推理和分析过程" },
      needTool: { type: "boolean", description: "是否需要调用工具" },
      toolName: { type: "string", description: "工具名称（如果 needTool 为 true）" },
      toolParams: { type: "object", description: "工具参数字典", additionalProperties: true },
      response: { type: "string", description: "给用户的最终回复" },
    },
    required: ["thinking", "needTool", "response"],
    additionalProperties: false,
  };
}

/** ReActAgent 的 OpenAI JSON Schema */
export function getReActAgentJsonSchema(): object {
  return {
    type: "object",
    properties: {
      thought: { type: "string", description: "当前迭代的思考过程" },
      action: { type: "string", description: "要执行的工具名称，或 'finish' 表示完成" },
      actionParams: { type: "object", description: "工具参数字典", additionalProperties: true },
      response: { type: "string", description: "最终回复（仅当 action 为 'finish' 时需要）" },
    },
    required: ["thought", "action", "actionParams"],
    additionalProperties: false,
  };
}

/** MainAgent 的 OpenAI JSON Schema */
export function getMainAgentJsonSchema(): object {
  return {
    type: "object",
    properties: {
      thinking: { type: "string", description: "任务分析过程" },
      needSplit: { type: "boolean", description: "是否需要拆分为子任务" },
      subtasks: {
        type: "array",
        description: "子任务列表",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "子任务 ID" },
            description: { type: "string", description: "子任务描述" },
            assignedTo: { type: "string", description: "分配给的 Worker 名称" },
            params: { type: "object", description: "任务参数", additionalProperties: true },
            status: { type: "string", enum: ["pending", "running", "completed", "failed"], description: "任务状态" },
          },
          required: ["id", "description", "assignedTo", "status"],
          additionalProperties: false,
        },
      },
      directResponse: { type: "string", description: "如果不拆解，直接回复用户的内容" },
    },
    required: ["thinking", "needSplit", "subtasks"],
    additionalProperties: false,
  };
}

/**
 * 验证并转换 SimpleAgent 输出
 */
export function parseSimpleAgentOutput(data: unknown): SimpleAgentOutput {
  return SimpleAgentSchema.parse(data);
}

/**
 * 验证并转换 ReActAgent 输出
 */
export function parseReActAgentOutput(data: unknown): ReActAgentOutput {
  return ReActAgentSchema.parse(data);
}

/**
 * 验证并转换 MainAgent 输出
 */
export function parseMainAgentOutput(data: unknown): MainAgentOutput {
  return MainAgentSchema.parse(data);
}