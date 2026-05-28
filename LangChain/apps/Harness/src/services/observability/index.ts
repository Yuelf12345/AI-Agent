/**
 * Observability 可观测性系统入口
 * 
 * 包含三大核心模块：
 *   1. Tracing — 链路追踪，记录请求的完整调用链
 *   2. Metrics — 指标统计，收集延迟、Token 消耗等运行时数据
 *   3. Logger — 结构化日志，便于搜索和分析
 * 
 * 使用方式：
 *   import { Tracer, Metrics, Logger, globalTracer, globalMetrics, globalLogger } from "../services/observability/index.ts";
 *   
 *   // 追踪
 *   const span = tracer.startSpan("operation");
 *   // ... 执行操作 ...
 *   span.end();
 *   
 *   // 指标
 *   metrics.recordLLMCall("gpt-4", 1200, 500);
 *   
 *   // 日志
 *   logger.info("Request completed", { latency: 1200 });
 */

export { Tracer, globalTracer, traceable } from "./tracing.ts";
export type { Span, SpanContext, SpanTag, SpanLog } from "./tracing.ts";

export { Metrics, globalMetrics } from "./metrics.ts";
export type { MetricType, MetricValue, HistogramStats, TimerContext } from "./metrics.ts";

export { Logger, globalLogger, log } from "./logger.ts";
export type { LogLevel, LogEntry, LoggerConfig } from "./logger.ts";