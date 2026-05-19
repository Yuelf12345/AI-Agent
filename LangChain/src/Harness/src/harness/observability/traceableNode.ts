/**
 * Observability 包装器 - 为 Harness 节点添加可观测性
 *
 * 使用方式：
 *   import { traceableNode } from "../observability/traceableNode.ts";
 *
 *   // 在 harnessGraph.ts 中
 *   .addNode("router", traceableNode("router", routerNode))
 *   .addNode("memory", traceableNode("memory", memoryNode))
 *
 * 每个节点执行时会自动：
 *   1. 创建 Tracing Span（记录开始/结束时间、标签）
 *   2. 记录 Metrics（执行耗时、节点调用计数、成功/失败计数）
 *   3. 输出结构化 Logger（节点名、耗时、状态）
 */

import { globalTracer } from "../../services/observability/tracing.ts";
import { globalMetrics } from "../../services/observability/metrics.ts";
import { globalLogger } from "../../services/observability/logger.ts";
import type { TimerContext } from "../../services/observability/metrics.ts";

/**
 * 将节点函数包装为可观测节点
 *
 * @param nodeName 节点名称
 * @param nodeFn 原始节点函数
 * @returns 包装后的节点函数，行为与原始函数一致，增加可观测性
 */
export function traceableNode(
  nodeName: string,
  nodeFn: (state: any) => Promise<Partial<any> | any>,
): (state: any) => Promise<Partial<any> | any> {
  return async (state: any) => {
    // ---- 1. Tracing: 创建 Span ----
    globalTracer.startSpan(`node.${nodeName}`, [
      { key: "node.name", value: nodeName },
    ]);

    // ---- 2. Metrics: 开始计时 + 计数 ----
    const timer: TimerContext = globalMetrics.startTimer(`node.${nodeName}.latency`, { node: nodeName });
    globalMetrics.incrementCounter(`node.${nodeName}.calls`, 1, { node: nodeName });

    // ---- 3. Logger: 记录开始 ----
    globalLogger.info(`Node ${nodeName} started`, {
      node: nodeName,
      input_keys: Object.keys(state).join(","),
    });

    const startTime = Date.now();

    try {
      // ---- 执行原始节点 ----
      const result = await nodeFn(state);

      // ---- 4. 记录成功 ----
      globalTracer.addTag("node.status", "ok");
      globalTracer.addLog("Node completed", {
        result_keys: result && typeof result === "object" ? Object.keys(result).join(",") : "none",
      });

      globalMetrics.endTimer(timer);
      globalMetrics.incrementCounter(`node.${nodeName}.success`, 1, { node: nodeName });

      const latency = Date.now() - startTime;
      globalLogger.info(`Node ${nodeName} completed`, {
        node: nodeName,
        latency_ms: latency,
        result_keys: result && typeof result === "object" ? Object.keys(result).join(",") : "none",
      });

      // ---- 5. 结束 Span ----
      globalTracer.endSpan();

      return result;
    } catch (error: any) {
      // ---- 6. 记录错误 ----
      globalTracer.addTag("node.status", "error");
      globalTracer.addTag("error.message", error.message || String(error));
      globalTracer.setError(error);

      globalMetrics.endTimer(timer);
      globalMetrics.incrementCounter(`node.${nodeName}.errors`, 1, { node: nodeName });

      const latency = Date.now() - startTime;
      globalLogger.error(`Node ${nodeName} failed`, {
        node: nodeName,
        latency_ms: latency,
        error: error.message || String(error),
      });

      // ---- 7. 结束 Span ----
      globalTracer.endSpan();

      throw error;
    }
  };
}

/**
 * 批量包装节点
 *
 * 使用方式：
 *   const tracedNodes = traceAllNodes({
 *     router: routerNode,
 *     memory: memoryNode,
 *     rag: ragNode,
 *   });
 */
export function traceAllNodes(
  nodes: Record<string, (state: any) => Promise<Partial<any> | any>>,
): Record<string, (state: any) => Promise<Partial<any> | any>> {
  const result: Record<string, (state: any) => Promise<Partial<any> | any>> = {};
  for (const [name, fn] of Object.entries(nodes)) {
    result[name] = traceableNode(name, fn);
  }
  return result;
}