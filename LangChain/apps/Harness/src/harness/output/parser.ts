/**
 * Structured Output Parser - 结构化输出解析器
 *
 * 提供两种解析策略：
 * 1. 结构化输出（优先）：使用 OpenAI response_format + Zod schema
 * 2. 正则解析（降级）：当结构化输出失败时的备用方案
 */

import { z } from "zod";
import type {
  SimpleAgentOutput,
  ReActAgentOutput,
  MainAgentOutput,
} from "./schemas.ts";

/**
 * 解析结果包装
 */
export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fallbackUsed: boolean;
}

/**
 * 结构化输出解析器
 *
 * 使用 Zod 进行类型安全的解析
 */
export class StructuredOutputParser {
  /**
   * 解析 SimpleAgent 输出
   */
  static parseSimpleAgent(content: string): ParseResult<SimpleAgentOutput> {
    try {
      const data = JSON.parse(content);
      const parsed = data as SimpleAgentOutput;
      return {
        success: true,
        data: parsed,
        fallbackUsed: false,
      };
    } catch (error) {
      return {
        success: false,
        error: `解析失败: ${(error as Error).message}`,
        fallbackUsed: false,
      };
    }
  }

  /**
   * 解析 ReActAgent 输出
   */
  static parseReActAgent(content: string): ParseResult<ReActAgentOutput> {
    try {
      const data = JSON.parse(content);
      const parsed = data as ReActAgentOutput;
      return {
        success: true,
        data: parsed,
        fallbackUsed: false,
      };
    } catch (error) {
      return {
        success: false,
        error: `解析失败: ${(error as Error).message}`,
        fallbackUsed: false,
      };
    }
  }

  /**
   * 解析 MainAgent 输出
   */
  static parseMainAgent(content: string): ParseResult<MainAgentOutput> {
    try {
      const data = JSON.parse(content);
      const parsed = data as MainAgentOutput;
      return {
        success: true,
        data: parsed,
        fallbackUsed: false,
      };
    } catch (error) {
      return {
        success: false,
        error: `解析失败: ${(error as Error).message}`,
        fallbackUsed: false,
      };
    }
  }
}

/**
 * 正则解析器（降级方案）
 *
 * 当结构化输出失败时，使用正则表达式提取 JSON
 */
export class RegexFallbackParser {
  /**
   * 提取 JSON（通用方法）
   */
  static extractJson(content: string): string | null {
    // 尝试匹配 {...} 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : null;
  }

  /**
   * 降级解析 SimpleAgent 输出
   */
  static parseSimpleAgentFallback(content: string): SimpleAgentOutput {
    const jsonStr = RegexFallbackParser.extractJson(content);
    if (!jsonStr) {
      return {
        thinking: "解析失败，使用原始内容",
        needTool: false,
        response: content,
      };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        thinking: parsed.thinking || "降级解析",
        needTool: parsed.needTool ?? false,
        toolName: parsed.toolName,
        toolParams: parsed.toolParams,
        response: parsed.response || content,
      };
    } catch {
      return {
        thinking: "降级解析失败",
        needTool: false,
        response: content,
      };
    }
  }

  /**
   * 降级解析 ReActAgent 输出
   */
  static parseReActAgentFallback(content: string): ReActAgentOutput {
    const jsonStr = RegexFallbackParser.extractJson(content);
    if (!jsonStr) {
      return {
        thought: "解析失败，使用原始内容",
        action: "finish",
        actionParams: {},
        response: content,
      };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        thought: parsed.thought || "降级解析",
        action: parsed.action || "finish",
        actionParams: parsed.actionParams || parsed.action_params || {},
        response: parsed.response,
      };
    } catch {
      return {
        thought: "降级解析失败",
        action: "finish",
        actionParams: {},
        response: content,
      };
    }
  }

  /**
   * 降级解析 MainAgent 输出
   */
  static parseMainAgentFallback(content: string): MainAgentOutput {
    const jsonStr = RegexFallbackParser.extractJson(content);
    if (!jsonStr) {
      return {
        thinking: "解析失败，使用原始内容",
        needSplit: false,
        subtasks: [],
        directResponse: content,
      };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        thinking: parsed.thinking || "降级解析",
        needSplit: parsed.needSplit ?? false,
        subtasks: (parsed.subtasks || []).map((task: any, index: number) => ({
          id: task.id || `task-${index + 1}`,
          description: task.description || "",
          assignedTo: task.assignedTo || "Unknown",
          params: task.params,
          status: "pending" as const,
        })),
        directResponse: parsed.directResponse,
      };
    } catch {
      return {
        thinking: "降级解析失败",
        needSplit: false,
        subtasks: [],
        directResponse: content,
      };
    }
  }
}

/**
 * 统一解析入口
 *
 * 优先尝试结构化解析，失败时使用正则降级
 */
export function parseAgentOutput<T>(
  content: string,
  parser: (content: string) => ParseResult<T>,
  fallbackParser: (content: string) => T
): T {
  const result = parser(content);

  if (result.success && result.data) {
    return result.data;
  }

  // 结构化解析失败，使用降级方案
  console.warn(`[StructuredOutput] 结构化解析失败: ${result.error}，使用正则降级`);
  return fallbackParser(content);
}