/**
 * Harness HTTP 服务 - 基于 Koa 框架
 *
 * 依赖安装：
 *   npm install koa @koa/cors @koa/router koa-bodyparser
 *   npm install -D @types/koa @types/koa-bodyparser @types/koa__cors @types/koa__router
 *
 * API 端点：
 *   POST /api/harness       — 执行完整 Harness 链路（路由 → Memory → RAG → Agent → 输出）
 *   POST /api/approve        — 恢复中断审批（approve/reject）
 *   GET  /api/health         — 健康检查
 *   GET  /api/observability  — 获取 Tracing/Metrics 统计
 *
 * 旧端点保留（向后兼容）：
 *   POST /api/chat           — 直接 LLM 调用
 *   POST /api/agent/simple  — SimpleAgent 直接调用
 */

import Koa from "koa";
import bodyParser from "koa-bodyparser";
import cors from "@koa/cors";
import Router from "@koa/router";
import type { Context, Next } from "koa";
import { config } from "./config/index.ts";
import { llmService } from "./services/llm.ts";
import { SimpleAgent } from "./harness/agents/simpleAgent.ts";
import {
  createProductionHarnessGraph,
  executeHarnessTask,
  resumeHarnessTask,
  MemoryCheckpointer,
} from "./harness/engine/harnessGraph.ts";
import { globalTracer } from "./services/observability/tracing.ts";
import { globalMetrics } from "./services/observability/metrics.ts";
import { globalLogger } from "./services/observability/logger.ts";

const app = new Koa();
const router = new Router();

// ==================== 活跃线程管理 ====================

const activeThreads = new Map<string, { checkpointer: MemoryCheckpointer; startTime: number }>();

// ==================== 错误处理中间件 ====================

app.use(async (ctx: Context, next: Next) => {
  try {
    await next();
  } catch (err: any) {
    const error = err instanceof Error ? err.message : String(err);
    globalLogger.error("Koa middleware error", { error });
    ctx.status = err.status || 500;
    ctx.body = { error };
  }
});

// ==================== 路由 ====================

// POST /api/harness — 完整 Harness 链路
router.post("/api/harness", async (ctx: Context) => {
  const { message, threadId, maxIterations } = ctx.request.body as any;

  if (!message) {
    ctx.status = 400;
    ctx.body = { error: "message 不能为空" };
    return;
  }

  const checkpointer = new MemoryCheckpointer();
  const tid = threadId || `thread-${Date.now()}`;

  activeThreads.set(tid, { checkpointer, startTime: Date.now() });

  const result = await executeHarnessTask(message, {
    threadId: tid,
    maxIterations: maxIterations || 5,
    checkpointer,
  });

  if (result.interrupt && result.interrupt.length > 0) {
    ctx.body = {
      status: "paused",
      threadId: tid,
      interrupt: result.interrupt,
      message: "任务需要人工审批，请调用 /api/approve 继续",
    };
    return;
  }

  activeThreads.delete(tid);
  ctx.body = {
    status: result.status,
    response: result.response,
    taskType: result.taskType,
    toolCalls: result.toolCalls,
    memoryContext: result.memoryContext,
    ragContext: result.ragContext,
  };
});

// POST /api/approve — 恢复中断审批
router.post("/api/approve", async (ctx: Context) => {
  const { threadId, approved, decision } = ctx.request.body as any;

  if (!threadId) {
    ctx.status = 400;
    ctx.body = { error: "threadId 不能为空" };
    return;
  }

  const threadInfo = activeThreads.get(threadId);
  if (!threadInfo) {
    ctx.status = 404;
    ctx.body = { error: "线程不存在或已过期" };
    return;
  }

  const resumeValue = decision || approved;

  const result = await resumeHarnessTask(
    threadId,
    resumeValue,
    threadInfo.checkpointer,
  );

  if (result.__interrupt__ && result.__interrupt__.length > 0) {
    ctx.body = {
      status: "paused",
      threadId,
      interrupt: result.__interrupt__,
      message: "仍有操作需要审批",
    };
    return;
  }

  activeThreads.delete(threadId);
  ctx.body = {
    status: result.status || "completed",
    response: result.finalResponse || "",
    taskType: result.taskType,
  };
});

// GET /api/observability — 可观测性统计
router.get("/api/observability", async (ctx: Context) => {
  ctx.body = {
    tracing: globalTracer.getSummary(),
    metrics: globalMetrics.getAllMetrics(),
  };
});

// ==================== 向后兼容端点 ====================

// POST /api/chat — 直接 LLM 对话
router.post("/api/chat", async (ctx: Context) => {
  const { message, messages } = ctx.request.body as any;

  if (!message && !messages) {
    ctx.status = 400;
    ctx.body = { error: "消息不能为空" };
    return;
  }

  const chatMessages = messages || [{ role: "user", content: message }];
  const response = await llmService.chat(chatMessages);
  ctx.body = { response };
});

// POST /api/agent/simple — SimpleAgent
router.post("/api/agent/simple", async (ctx: Context) => {
  const { message } = ctx.request.body as any;

  if (!message) {
    ctx.status = 400;
    ctx.body = { error: "消息不能为空" };
    return;
  }

  const agent = new SimpleAgent();
  const result = await agent.execute(message);
  ctx.body = { result };
});

// GET /api/health — 健康检查
router.get("/api/health", async (ctx: Context) => {
  ctx.body = {
    status: "ok",
    model: config.llm.openai.model,
    provider: config.llm.provider,
    activeThreads: activeThreads.size,
  };
});

// ==================== 启动 ====================

const PORT = config.server.port;
const HOST = config.server.host;

// 预编译 Harness Graph
try {
  createProductionHarnessGraph();
  console.log("[Harness] Production graph compiled successfully");
} catch (error) {
  console.error("[Harness] Graph compilation failed:", error);
}

// 安装中间件
app.use(cors());
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, HOST, () => {
  console.log(`[Harness] 服务启动: http://${HOST}:${PORT}`);
  console.log(`[Harness] 模型: ${config.llm.openai.model}`);
});

export default app;