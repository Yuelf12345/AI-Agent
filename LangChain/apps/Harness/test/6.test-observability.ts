/**
 * 可观测性系统测试脚本
 * 
 * 测试 Tracing、Metrics、Logger 三大模块：
 *   Step 1: Tracing — 链路追踪
 *   Step 2: Metrics — 指标统计
 *   Step 3: Logger — 结构化日志
 *   Step 4: 集成 — 完整可观测性流程
 * 
 * 运行方式：
 *   tsx src/Harness/test/test-observability.ts
 */

import { Tracer, Metrics, Logger } from "../src/services/observability/index.ts";

function separator(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ==================== Step 1: Tracing ====================

function testTracing() {
  separator("Step 1: Tracing — 链路追踪");

  const tracer = new Tracer();

  // 模拟完整请求流程
  const rootSpan = tracer.startSpan("handleRequest");
  tracer.addTag("userId", "user_123");
  tracer.addTag("endpoint", "/api/chat");

  // LLM 调用
  const llmSpan = tracer.startSpan("llm.call");
  llmSpan.tags.push({ key: "model", value: "gpt-4" });
  tracer.addLog("Starting LLM call", { promptLength: 100 });
  
  // 模拟 LLM 调用耗时
  const start = Date.now();
  while (Date.now() - start < 50) {} // 50ms
  
  tracer.addLog("LLM call completed", { responseLength: 200 });
  tracer.endSpan();

  // RAG 检索
  const ragSpan = tracer.startSpan("rag.retrieve");
  tracer.addTag("mode", "hybrid");
  
  const ragStart = Date.now();
  while (Date.now() - ragStart < 30) {} // 30ms
  
  tracer.endSpan();

  // 结束根 Span
  tracer.endSpan();

  // 输出追踪结果
  console.log(tracer.formatTrace());

  const summary = tracer.getSummary();
  console.log("\n追踪摘要:");
  console.log(`  Trace ID: ${summary.traceId}`);
  console.log(`  Span 数量: ${summary.spanCount}`);
  console.log(`  总耗时: ${summary.duration}ms`);
  console.log(`  错误数: ${summary.errorCount}`);
}

// ==================== Step 2: Metrics ====================

function testMetrics() {
  separator("Step 2: Metrics — 指标统计");

  const metrics = new Metrics();

  // 模拟 LLM 调用指标
  console.log("--- 记录 LLM 调用指标 ---");
  
  // 模拟多次调用
  for (let i = 0; i < 10; i++) {
    const latency = 500 + Math.random() * 1000; // 500-1500ms
    const tokens = 100 + Math.floor(Math.random() * 400); // 100-500 tokens
    metrics.recordLLMCall("gpt-4", latency, tokens);
  }

  // 模拟 RAG 检索指标
  for (let i = 0; i < 5; i++) {
    const latency = 100 + Math.random() * 200;
    const results = 3 + Math.floor(Math.random() * 5);
    metrics.recordRAGRetrieval(latency, results);
  }

  // 记录错误
  metrics.recordError("timeout");
  metrics.recordError("api_error");

  // 获取统计
  console.log("\n--- LLM 延迟统计 ---");
  const llmStats = metrics.getHistogramStats("llm.latency", { model: "gpt-4" });
  if (llmStats) {
    console.log(`  次数: ${llmStats.count}`);
    console.log(`  平均: ${llmStats.mean.toFixed(1)}ms`);
    console.log(`  P50: ${llmStats.p50.toFixed(1)}ms`);
    console.log(`  P90: ${llmStats.p90.toFixed(1)}ms`);
    console.log(`  P99: ${llmStats.p99.toFixed(1)}ms`);
  }

  console.log("\n--- Token 消耗统计 ---");
  const tokenStats = metrics.getHistogramStats("llm.tokens", { model: "gpt-4" });
  if (tokenStats) {
    console.log(`  总 Token: ${tokenStats.sum}`);
    console.log(`  平均: ${tokenStats.mean.toFixed(1)}`);
  }

  console.log("\n--- 计数器 ---");
  console.log(`  LLM 请求总数: ${metrics.getCounter("llm.requests.total", { model: "gpt-4" })}`);
  console.log(`  RAG 检索总数: ${metrics.getCounter("rag.retrievals.total")}`);
  console.log(`  错误总数: ${metrics.getCounter("errors.total", { type: "timeout" })}`);

  // Prometheus 格式导出
  console.log("\n--- Prometheus 格式 ---");
  console.log(metrics.toPrometheus());
}

// ==================== Step 3: Logger ====================

function testLogger() {
  separator("Step 3: Logger — 结构化日志");

  const logger = new Logger({ minLevel: "debug", timestamp: true });

  // 设置追踪 ID
  logger.setTraceId("req_abc123");

  // 不同级别日志
  logger.debug("Debug message", { detail: "only in dev" });
  logger.info("User logged in", { userId: "user_123", method: "password" });
  logger.warn("Rate limit approaching", { current: 90, max: 100 });
  logger.error("API request failed", { status: 500, endpoint: "/api/chat" });

  // 清除追踪 ID
  logger.clearTraceId();
  logger.info("Request completed", { duration: 1250 });

  // 搜索日志
  console.log("\n--- 搜索 'user' 相关日志 ---");
  const results = logger.search("user");
  results.forEach(log => {
    console.log(`  [${log.level}] ${log.message}`);
  });

  // 按级别过滤
  console.log("\n--- 过滤 Error 及以上日志 ---");
  const errors = logger.filterByLevel("error");
  errors.forEach(log => {
    console.log(`  [${log.level}] ${log.message}`);
  });
}

// ==================== Step 4: 集成示例 ====================

async function testIntegrated() {
  separator("Step 4: 集成 — 完整可观测性流程");

  const tracer = new Tracer();
  const metrics = new Metrics();
  const logger = new Logger({ minLevel: "info" });

  // 模拟完整请求处理流程
  const span = tracer.startSpan("handleUserQuery");
  logger.setTraceId(tracer.getSummary().traceId);

  try {
    logger.info("Processing user query", { query: "什么是 RAG?" });

    // Step 1: RAG 检索
    const retrieveSpan = tracer.startSpan("rag.retrieve");
    const timer = metrics.startTimer("rag.latency");

    // 模拟检索耗时
    await new Promise(r => setTimeout(r, 100));

    metrics.endTimer(timer);
    logger.info("RAG retrieval completed", { resultCount: 5 });
    tracer.endSpan();

    // Step 2: LLM 生成
    const llmSpan = tracer.startSpan("llm.generate");
    const llmTimer = metrics.startTimer("llm.latency", { model: "gpt-4" });

    // 模拟 LLM 调用
    await new Promise(r => setTimeout(r, 800));

    metrics.recordLLMCall("gpt-4", 800, 350);
    metrics.incrementCounter("llm.requests.success", 1, { model: "gpt-4" });
    logger.info("LLM generation completed", { tokens: 350 });
    tracer.endSpan();

    logger.info("Query processed successfully", { totalLatency: 900 });

  } catch (error: any) {
    metrics.recordError("handle_query");
    logger.error("Query processing failed", { error: error.message });
    tracer.setError(error);
  } finally {
    tracer.endSpan();
    logger.clearTraceId();
  }

  // 输出完整追踪
  console.log("\n--- 完整追踪 ---");
  console.log(tracer.formatTrace());

  // 输出指标摘要
  console.log("\n--- 指标摘要 ---");
  const ragLatency = metrics.getHistogramStats("rag.latency");
  const llmLatency = metrics.getHistogramStats("llm.latency", { model: "gpt-4" });
  console.log(`  RAG 延迟: ${ragLatency?.mean.toFixed(1)}ms`);
  console.log(`  LLM 延迟: ${llmLatency?.mean.toFixed(1)}ms`);
  console.log(`  请求成功: ${metrics.getCounter("llm.requests.success", { model: "gpt-4" })}`);
}

// ==================== Main ====================

async function main() {
  console.log("=== 可观测性系统测试 ===\n");
  console.log("三大核心模块:");
  console.log("  1. Tracing — 链路追踪，记录完整调用链");
  console.log("  2. Metrics — 指标统计，收集延迟、Token 等");
  console.log("  3. Logger  — 结构化日志，便于搜索分析");

  testTracing();
  testMetrics();
  testLogger();
  await testIntegrated();

  console.log("\n=== 可观测性总结 ===");
  console.log("Tracing: 追踪请求的完整调用链，定位性能瓶颈");
  console.log("Metrics: 量化系统性能，优化资源使用");
  console.log("Logger: 结构化日志，便于问题排查和审计");
}

main().catch(console.error);