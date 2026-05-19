/**
 * Engine - StateGraph 编排引擎导出
 *
 * 用于构建有状态、可中断的 Agent 图的核心模块。
 */

// 状态
export { StateSchema, StateField } from "./state.ts";
export { AgentState, TaskState, MessagesState } from "./state.ts";

// 节点（仅类型）
export type { GraphNode, NodeConfig, NodeDefinition } from "./node.ts";
export { createNode } from "./node.ts";

// 边
export { EdgeType, START, END } from "./edge.ts";
export type { ConditionalRouter, EdgeDefinition } from "./edge.ts";

// 命令
export { Command, InterruptSignal, interrupt, waitForApproval, waitForInput } from "./command.ts";
export type { InterruptRequest } from "./command.ts";

// 图
export { StateGraph, CompiledGraph, MemoryCheckpointer } from "./stateGraph.ts";
export type { Checkpointer, GraphConfig } from "./stateGraph.ts";

// Harness 专用
export {
  createHarnessGraph,
  createSimpleHarnessGraph,
  createReActHarnessGraph,
  executeHarnessTask,
  resumeHarnessTask,
} from "./harnessGraph.ts";

// 节点函数
export {
  routerNode,
  simpleAgentNode,
  reactAgentNode,
  approvalNode,
  executeToolNode,
  errorNode,
  routeByTaskType,
  shouldContinue,
  afterToolExecution,
} from "./harnessNodes.ts";