/**
 * Node - 图执行节点定义
 *
 * 核心概念：节点是图中的执行单元。
 * 每个节点接收当前状态并返回部分更新。
 */

import type { Command } from "./command.ts";

/**
 * GraphNode - 处理状态并返回更新的函数
 *
 * 可执行：
 *   - 调用 LLM
 *   - 调用工具
 *   - 触发中断（暂停等待人工审批）
 *   - 返回 Command（跳转到指定节点）
 *
 * @param state - 图中的当前状态
 * @returns 状态部分更新或 Command
 */
export type GraphNode<TState extends Record<string, any>> =
  (state: TState) => Promise<Partial<TState> | Command<any>>;

/**
 * NodeConfig - 节点配置
 */
export interface NodeConfig {
  /** 是否在节点执行前中断（人机交互） */
  interruptBefore?: boolean;
  /** 是否在节点执行后中断（人机交互） */
  interruptAfter?: boolean;
  /** 使用 Command goto 时允许的跳转目标 */
  ends?: string[] | undefined;
  /** 节点描述（用于调试） */
  description?: string | undefined;
}

/**
 * NodeDefinition - 完整的节点注册信息
 */
export interface NodeDefinition<TState extends Record<string, any>> {
  name: string;
  fn: GraphNode<TState>;
  config: NodeConfig | undefined;
}

/**
 * createNode - 简单节点包装器
 *
 * 从简单函数创建 GraphNode 的辅助函数
 */
export function createNode<TState extends Record<string, any>>(
  name: string,
  fn: (state: TState) => Promise<Partial<TState>>,
  config?: NodeConfig
): NodeDefinition<TState> {
  return {
    name,
    fn: async (state) => fn(state),
    config: config ?? undefined,
  };
}