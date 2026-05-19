# Harness Agent Step 1-9 实现记录

> 记录 Step 1 到 Step 9 的关键实现代码，涵盖 interrupt/resume 机制、Tool Registry 统一、Memory/RAG 接入、Router 改造、Agent 上下文注入、Observability、Graph 重构、Server 改造。

---

## Step 1: 修复 StateGraph interrupt/resume 传值机制

### 核心问题

`interrupt()` 抛出 `InterruptSignal`，恢复时 `_resumeFromInterrupt` 不区分中断类型，无法将 `resumeValue` 传回节点函数。

### 新增常量 (`engine/command.ts`)

```typescript
export const RESUME_VALUE_KEY = "__resumeValue__";
export const INTERRUPT_TYPE_KEY = "__interruptType__";
```

- `RESUME_VALUE_KEY`：恢复时 `resumeValue` 注入到 `state.__resumeValue__`，节点函数先检查此字段
- `INTERRUPT_TYPE_KEY`：区分三种中断类型，决定恢复策略

### Checkpointer 接口变更 (`engine/stateGraph.ts`)

```typescript
export interface Checkpointer {
  save(threadId: string, state: Record<string, any>, nodeId: string, interruptType?: string | undefined): Promise<void>;
  load(threadId: string): Promise<{ state: Record<string, any>; nodeId: string; interruptType?: string | undefined } | null>;
  delete(threadId: string): Promise<void>;
  listThreads(): Promise<string[]>;
}
```

### `_resumeFromInterrupt` 三路分支 (`engine/stateGraph.ts`)

```typescript
private async _resumeFromInterrupt(threadId: string, resumeValue: any) {
  const checkpoint = await this.checkpointer.load(threadId);
  let state = checkpoint.state as TState;
  let currentNode = checkpoint.nodeId;
  const interruptType = checkpoint.interruptType || "interrupt_signal";

  let startNode: string;

  if (interruptType === "interrupt_after") {
    // 节点已执行完毕 → 跳过重执行，继续下一个节点
    startNode = this._getNextNode(currentNode, state);
  } else {
    // interrupt_before / interrupt_signal → 注入 resumeValue，重新执行节点
    state = { ...state, [RESUME_VALUE_KEY]: resumeValue } as TState;
    const result = await nodeDef.fn(state);

    // 清除 __resumeValue__
    delete cleanResult[RESUME_VALUE_KEY];
    delete (state as any)[RESUME_VALUE_KEY];

    // 合并结果，获取下一个节点
    startNode = this._getNextNode(currentNode, state);
  }

  // 从 startNode 继续执行后续节点...
}
```

### approvalNode 恢复模式 (`engine/harnessNodes.ts`)

```typescript
export async function approvalNode(state: any): Promise<Partial<any> | Command> {
  const pendingAction = state.pendingAction || state.toolCalls?.[...];

  // 恢复模式：检查 __resumeValue__
  if (state[RESUME_VALUE_KEY] !== undefined) {
    const resumeValue = state[RESUME_VALUE_KEY];
    if (typeof resumeValue === "object" && resumeValue.decision) {
      // 处理 ApprovalDecision 对象 (approved/modified/rejected)
    }
    if (resumeValue === true) return { approvalStatus: "approved", ... };
    return { approvalStatus: "rejected", ... };
  }

  // 新调用：触发中断
  interrupt({ type: "approval_request", ... });
  return { approvalStatus: "pending", currentStep: "approval" };
}
```

---

## Step 2: 统一 Tool Registry

### 新增 `HarnessToolRegistry` (`tools/registry.ts`)

合并旧 `ToolRegistry`（分类、描述、args 接口）和 `EnhancedToolRegistry`（Retry/Timeout/Cache）：

```typescript
export class HarnessToolRegistry extends EnhancedToolRegistry {
  private categories: Map<string, string[]> = new Map();

  // 注册时维护分类索引
  override register(tool: BaseTool<any>, config?: ToolCallConfig): void {
    super.register(tool, config);
    const category = tool.toolMetadata.category;
    this.categories.set(category, [...this.categories.get(category) || [], tool.name]);
  }

  // 兼容两种参数格式
  async invokeCompat(toolCall: { name: string; args?: any; parameters?: any }): Promise<string> {
    const params = toolCall.args ?? toolCall.parameters ?? {};
    return super.invoke({ name: toolCall.name, parameters: params });
  }

  // 分类、描述、列表
  getByCategory(category: string): BaseTool<any>[] { ... }
  getDescriptions(category?: string): string { ... }
  list(): string[] { ... }
  listCategories(): string[] { ... }
}
```

### 全局单例 + 预注册基础工具

```typescript
export const harnessToolRegistry = new HarnessToolRegistry();

harnessToolRegistry.register(new FileReadTool(), {
  timeout: { timeoutMs: 10000 }, enableCache: true, cache: { ttlMs: 30000 },
});
harnessToolRegistry.register(new FileWriteTool(), {
  timeout: { timeoutMs: 15000 }, retry: { maxRetries: 2 },
});
harnessToolRegistry.register(new FileEditTool(), {
  timeout: { timeoutMs: 15000 }, retry: { maxRetries: 2 },
});
harnessToolRegistry.register(new BashTool(), {
  timeout: { timeoutMs: 30000 },
});
```

### 向后兼容

```typescript
/** @deprecated 使用 harnessToolRegistry 代替 */
export const toolRegistry = harnessToolRegistry;
/** @deprecated 使用 HarnessToolRegistry 代替 */
export { HarnessToolRegistry as ToolRegistry };
```

---

## Step 3: 接入 Memory

### memoryNode (`nodes/memoryNode.ts`)

```typescript
export async function memoryNode(state: any): Promise<Partial<any>> {
  const query = state.messages?.[state.messages.length - 1]?.content || "";
  const memory = getMemoryInstance();

  // 1. 从三层记忆检索
  const searchResults = await memory.search(query, 5);

  // 2. 构造记忆上下文
  const context = await memory.getContext(query);
  const memoryContext = context.toPrompt();

  // 3. 存入用户消息
  await memory.add({ id: `msg-user-${Date.now()}`, role: "user", content: query, ... });

  // 4. 组织知识
  const relevantKnowledge = searchResults.map((r) => ({
    content: r.message.content.slice(0, 500),
    source: r.source, score: r.score, role: r.message.role,
  }));

  return { memoryContext, relevantKnowledge, currentStep: "memory" };
}
```

依赖注入：`setMemoryInstance(memory)` / `getMemoryInstance()`

### outputNode (`nodes/outputNode.ts`)

```typescript
export async function outputNode(state: any): Promise<Partial<any>> {
  // 从 results 提取最终响应
  let response = state.finalResponse || state.results?.[0]?.response || ...;

  // 存入 Memory（重要回复 → 长期记忆）
  if (response && response.length > 20) {
    const memory = getMemoryInstance();
    await memory.add({ id: `msg-assistant-${Date.now()}`, role: "assistant", content: response, importance: 0.7, ... });
    memory.clearWorking(); // 清理推理过程
  }

  return { finalResponse: response, status: "completed", currentStep: "output" };
}
```

---

## Step 4: 接入 RAG

### ragNode (`nodes/ragNode.ts`)

```typescript
export async function ragNode(state: any): Promise<Partial<any>> {
  const query = state.messages?.[state.messages.length - 1]?.content || "";
  const rag = getRAGInstance();

  // 1. 初始化（首次）
  await rag.initialize();

  // 2. hybrid 检索（向量 + 关键词）
  const results = await rag.retrieve(query, "hybrid", 3);

  // 3. 构造 RAG 上下文文本
  const ragContext = results.map((r, i) => {
    const source = r.document.metadata?.source || "unknown";
    const score = r.finalScore?.toFixed(3) || "N/A";
    return `[文档${i + 1}] (来源: ${source}, 相关度: ${score})\n${r.document.pageContent.slice(0, 500)}`;
  }).join("\n\n");

  // 4. 元数据
  const ragDocuments = results.map((r) => ({
    content: r.document.pageContent.slice(0, 200),
    score: r.finalScore, source: r.document.metadata?.source,
  }));

  return { ragContext, ragDocuments, currentStep: "rag" };
}
```

依赖注入：`setRAGInstance(rag)` / `getRAGInstance()`

---

## Step 5: 改造 routerNode 使用真实 Router 类

### 旧实现（无效）

```typescript
// ❌ 旧代码：总是返回 taskType: "simple"
const agent = new MainAgent();
const result = await agent.execute(lastMessage);
return { taskType: "simple", plan: result, ... };
```

### 新实现

```typescript
export async function routerNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  try {
    const router = new Router();
    const result = await router.route(lastMessage);

    return {
      taskType: result.taskType,       // 真实判断：simple / complex
      reasoning: result.reasoning,     // 判断理由
      targetAgent: result.targetAgent,  // 目标 Agent
      confidence: result.confidence,   // 置信度
      currentStep: "router",
    };
  } catch (error) {
    return {
      taskType: "complex",  // 错误时默认复杂模式（更安全）
      reasoning: `路由失败: ${error}`,
      currentStep: "router",
    };
  }
}
```

---

## Step 6: Agent 节点注入 Memory + RAG 上下文

### buildEnrichedInput (`engine/harnessNodes.ts`)

将 Memory/RAG 上下文拼接到用户输入中，让 LLM 利用增强信息：

```typescript
function buildEnrichedInput(userMessage: string, state: any): string {
  const sections: string[] = [];

  if (state.memoryContext) {
    sections.push(`[记忆上下文]\n${state.memoryContext}`);
  }
  if (state.ragContext) {
    sections.push(`[知识检索]\n${state.ragContext}`);
  }
  if (state.relevantKnowledge?.length > 0) {
    const knowledge = state.relevantKnowledge
      .map((k: any) => `- (${k.source}, score: ${k.score?.toFixed(2) || "N/A"}) ${k.content}`)
      .join("\n");
    sections.push(`[相关知识]\n${knowledge}`);
  }

  if (sections.length === 0) return userMessage;
  sections.push(`[用户问题]\n${userMessage}`);
  return sections.join("\n\n");
}
```

### simpleAgentNode / reactAgentNode 使用增强输入

```typescript
export async function simpleAgentNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";
  const enrichedInput = buildEnrichedInput(lastMessage, state);  // ← 注入上下文
  const agent = new SimpleAgent();
  const result = await agent.execute(enrichedInput);
  return { results: [result], currentStep: "simpleAgent" };
}

export async function reactAgentNode(state: any): Promise<Partial<any> | Command> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";
  const enrichedInput = buildEnrichedInput(lastMessage, state);  // ← 注入上下文
  const agent = new ReActAgent({ maxIterations });
  const result = await agent.execute(enrichedInput);
  // ...
}
```

---

## 完整图流程 (harnessGraph.ts)

```
START → router → memory → rag → [simpleAgent / reactAgent] → ... → output → END
                                        ↓ simple
                               simpleAgent → output 或 approval → executeTool → output
                                        ↓ complex
                               reactAgent → 循环 → output 或 approval → executeTool → output
                               error → END
```

### 状态 Schema

```typescript
new StateSchema()
  .addField("messages", z.array(z.any()), "append")
  .addField("currentStep", z.string())
  .addField("iteration", z.number())
  .addField("status", z.enum(["idle", "running", "paused", "completed", "failed"]))
  .addField("taskType", z.enum(["simple", "complex"]).nullable())
  .addField("plan", z.any())
  .addField("reasoning", z.string().nullable())
  .addField("targetAgent", z.string().nullable())
  .addField("confidence", z.number().nullable())
  .addField("memoryContext", z.string().nullable())
  .addField("relevantKnowledge", z.array(z.any()), "append")
  .addField("ragContext", z.string().nullable())
  .addField("ragDocuments", z.array(z.any()), "append")
  .addField("toolCalls", z.array(z.any()), "append")
  .addField("toolResults", z.array(z.any()), "append")
  .addField("pendingAction", z.any())
  .addField("plannedTools", z.array(z.any()), "append")
  .addField("results", z.array(z.any()), "append")
  .addField("finalResponse", z.string().nullable())
  .addField("error", z.string().nullable())
  .addField("needsApproval", z.boolean().default(false))
  .addField("approvalStatus", z.enum(["pending", "approved", "rejected"]).nullable())
  .addField("maxIterations", z.number().default(5));
```

---

## 文件变更清单

| Step | 文件 | 变更类型 |
|------|------|----------|
| 1 | `engine/command.ts` | 修改：新增 `RESUME_VALUE_KEY` / `INTERRUPT_TYPE_KEY` |
| 1 | `engine/stateGraph.ts` | 修改：`Checkpointer` + `_resumeFromInterrupt` 重写 |
| 1 | `engine/harnessNodes.ts` | 修改：`approvalNode` 重写 |
| 1 | `engine/index.ts` | 修改：导出新增常量 |
| 2 | `tools/registry.ts` | 重写：`HarnessToolRegistry` 替代旧 `ToolRegistry` |
| 2 | `agents/baseAgent.ts` | 修改：引用改为 `HarnessToolRegistry` / `harnessToolRegistry` |
| 3 | `nodes/memoryNode.ts` | 新增 |
| 3 | `nodes/outputNode.ts` | 新增 |
| 3 | `nodes/index.ts` | 新增 |
| 3 | `engine/harnessGraph.ts` | 重写：集成 memory/output 节点 |
| 4 | `nodes/ragNode.ts` | 新增 |
| 4 | `nodes/index.ts` | 修改：增加 ragNode 导出 |
| 4 | `engine/harnessGraph.ts` | 修改：集成 rag 节点 |
| 5 | `engine/harnessNodes.ts` | 修改：`routerNode` 使用真实 `Router` |
| 5 | `engine/harnessGraph.ts` | 修改：状态 Schema 增加 reasoning/confidence/targetAgent |
| 6 | `engine/harnessNodes.ts` | 修改：`buildEnrichedInput()` + Agent 节点注入上下文 |

---

## Step 7: 接入 Observability

### traceableNode (`observability/traceableNode.ts`)

为所有 Harness 节点统一包装 Tracing + Metrics + Logger：

```typescript
export function traceableNode(nodeName: string, nodeFn: (state: any) => Promise<any>) {
  return async (state: any) => {
    // 1. Tracing：开始 Span
    globalTracer.startSpan(`node.${nodeName}`, [{ key: "node.name", value: nodeName }]);

    // 2. Metrics：计时 + 计数
    const timer: TimerContext = globalMetrics.startTimer(`node.${nodeName}.latency`, { node: nodeName });
    globalMetrics.incrementCounter(`node.${nodeName}.calls`, 1, { node: nodeName });

    // 3. Logger：记录开始
    globalLogger.info(`Node ${nodeName} started`, { node: nodeName, input_keys: Object.keys(state).join(",") });

    const startTime = Date.now();
    try {
      const result = await nodeFn(state);

      // 成功：标记 Span + 计数 + 日志
      globalTracer.addTag("node.status", "ok");
      globalTracer.addLog("Node completed", { result_keys: Object.keys(result).join(",") });
      globalMetrics.endTimer(timer);
      globalMetrics.incrementCounter(`node.${nodeName}.success`, 1, { node: nodeName });
      globalLogger.info(`Node ${nodeName} completed`, { node: nodeName, latency_ms: Date.now() - startTime });
      globalTracer.endSpan();

      return result;
    } catch (error: any) {
      // 失败：标记 Span + 计数 + 日志
      globalTracer.addTag("node.status", "error");
      globalTracer.setError(error);
      globalMetrics.endTimer(timer);
      globalMetrics.incrementCounter(`node.${nodeName}.errors`, 1, { node: nodeName });
      globalLogger.error(`Node ${nodeName} failed`, { node: nodeName, error: error.message });
      globalTracer.endSpan();

      throw error;
    }
  };
}
```

### Observability API 正确用法

```typescript
// Tracer API
globalTracer.startSpan(name, tags?)     // 开始 Span
globalTracer.addTag(key, value)         // 添加标签（Span 级别）
globalTracer.addLog(message, attrs?)    // 添加日志（Span 级别）
globalTracer.setError(error)            // 标记错误
globalTracer.endSpan()                  // 结束 Span

// Metrics API
globalMetrics.startTimer(name, labels?) // 返回 TimerContext
globalMetrics.endTimer(timer)           // 结束计时
globalMetrics.incrementCounter(name, delta, labels?)  // delta 必须是 number

// Logger API
globalLogger.info(message, attrs?)
globalLogger.error(message, attrs?)
```

### harnessGraph.ts 中包装所有 9 个节点

```typescript
const tRouter = traceableNode("router", routerNode);
const tMemory = traceableNode("memory", memoryNode);
const tRag = traceableNode("rag", ragNode);
const tSimple = traceableNode("simpleAgent", simpleAgentNode);
const tReact = traceableNode("reactAgent", reactAgentNode);
const tApproval = traceableNode("approval", approvalNode);
const tExecuteTool = traceableNode("executeTool", executeToolNode);
const tOutput = traceableNode("output", outputNode);
const tError = traceableNode("error", errorNode);

// 使用包装后的节点
const graph = new StateGraph(HarnessState)
  .addNode("router", tRouter, { description: "分析任务并确定路由" })
  .addNode("memory", tMemory, { description: "从三层记忆获取上下文" })
  .addNode("rag", tRag, { description: "从 RAG Pipeline 检索相关文档" })
  .addNode("simpleAgent", tSimple, { description: "处理简单任务" })
  .addNode("reactAgent", tReact, { description: "通过推理处理复杂任务" })
  .addNode("approval", tApproval, { interruptAfter: true, description: "请求人工审批" })
  .addNode("executeTool", tExecuteTool, { description: "执行已审批的工具" })
  .addNode("output", tOutput, { description: "统一输出并存入记忆" })
  .addNode("error", tError, { description: "优雅处理错误" });
```

---

## Step 8: 重构 HarnessGraph

### 修复 reactLoopRouter bug

旧代码检查 `results?.[0]`（第一个结果），但 `results` 是 append 模式，应检查最新结果：

```typescript
// ❌ 旧代码
if (state.results?.[0]?.type === "react_completed") return "output";

// ✅ 新代码
const latestResult = state.results?.[state.results.length - 1];
if (latestResult?.type === "react_completed" || latestResult?.type === "direct_response") return "output";
```

### 简化图也使用 traceableNode

```typescript
// createSimpleHarnessGraph
const tMemory = traceableNode("memory", memoryNode);
const tRag = traceableNode("rag", ragNode);
const tAgent = traceableNode("simpleAgent", simpleAgentNode);
const tOutput = traceableNode("output", outputNode);

// createReActHarnessGraph
const tMemory = traceableNode("memory", memoryNode);
const tRag = traceableNode("rag", ragNode);
const tAgent = traceableNode("reactAgent", async (state: any) => {
  return reactAgentNode({ ...state, maxIterations });
});
const tOutput = traceableNode("output", outputNode);
```

### createProductionHarnessGraph 导出

```typescript
export const createProductionHarnessGraph = createHarnessGraph;
```

### executeHarnessTask 返回增加 ragContext

```typescript
return {
  response: result.finalResponse || "",
  status: result.status,
  taskType: result.taskType,
  toolCalls: result.toolCalls,
  interrupt: result.__interrupt__,
  memoryContext: result.memoryContext,
  ragContext: result.ragContext,  // ← 新增
};
```

---

## Step 9: 改造 Server（Koa 框架）

### 依赖安装

```bash
npm install koa @koa/cors @koa/router koa-bodyparser
npm install -D @types/koa @types/koa-bodyparser @types/koa__cors @types/koa__router
```

### server.ts (`src/server.ts`)

从原生 `http` 模块改为 Koa 框架，新增完整 Harness 链路端点：

```typescript
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import cors from "@koa/cors";
import Router from "@koa/router";
import type { Context, Next } from "koa";

const app = new Koa();
const router = new Router();

// 错误处理中间件
app.use(async (ctx: Context, next: Next) => {
  try { await next(); }
  catch (err: any) {
    ctx.status = err.status || 500;
    ctx.body = { error: err instanceof Error ? err.message : String(err) };
  }
});

// POST /api/harness — 完整 Harness 链路
router.post("/api/harness", async (ctx: Context) => {
  const { message, threadId, maxIterations } = ctx.request.body as any;
  if (!message) { ctx.status = 400; ctx.body = { error: "message 不能为空" }; return; }

  const checkpointer = new MemoryCheckpointer();
  const tid = threadId || `thread-${Date.now()}`;
  activeThreads.set(tid, { checkpointer, startTime: Date.now() });

  const result = await executeHarnessTask(message, {
    threadId: tid, maxIterations: maxIterations || 5, checkpointer,
  });

  if (result.interrupt && result.interrupt.length > 0) {
    ctx.body = { status: "paused", threadId: tid, interrupt: result.interrupt, message: "需要审批" };
    return;
  }

  activeThreads.delete(tid);
  ctx.body = { status: result.status, response: result.response, taskType: result.taskType, ... };
});

// POST /api/approve — 恢复中断审批
router.post("/api/approve", async (ctx: Context) => {
  const { threadId, approved, decision } = ctx.request.body as any;
  // ... 从 activeThreads 取 checkpointer → resumeHarnessTask
});

// GET /api/observability — 可观测性统计
router.get("/api/observability", async (ctx: Context) => {
  ctx.body = { tracing: globalTracer.getSummary(), metrics: globalMetrics.getAllMetrics() };
});

// 安装中间件
app.use(cors());
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());
app.listen(PORT, HOST, () => { ... });
```

### 前端 Next.js 代理 (`Web/app/api/harness/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:3001";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${HARNESS_URL}/api/harness`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data);
}
```

### API 端点总览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/harness` | POST | 完整 Harness 链路（Memory + RAG + 路由 + Agent + 审批） |
| `/api/approve` | POST | 恢复中断审批 |
| `/api/observability` | GET | Tracing + Metrics 统计 |
| `/api/chat` | POST | 直接 LLM 调用（向后兼容） |
| `/api/health` | GET | 健康检查 |

---

## 文件变更清单

| Step | 文件 | 变更类型 |
|------|------|----------|
| 1 | `engine/command.ts` | 修改：新增 `RESUME_VALUE_KEY` / `INTERRUPT_TYPE_KEY` |
| 1 | `engine/stateGraph.ts` | 修改：`Checkpointer` + `_resumeFromInterrupt` 重写 |
| 1 | `engine/harnessNodes.ts` | 修改：`approvalNode` 重写 |
| 1 | `engine/index.ts` | 修改：导出新增常量 |
| 2 | `tools/registry.ts` | 重写：`HarnessToolRegistry` 替代旧 `ToolRegistry` |
| 2 | `agents/baseAgent.ts` | 修改：引用改为 `HarnessToolRegistry` / `harnessToolRegistry` |
| 3 | `nodes/memoryNode.ts` | 新增 |
| 3 | `nodes/outputNode.ts` | 新增 |
| 3 | `nodes/index.ts` | 新增 |
| 3 | `engine/harnessGraph.ts` | 重写：集成 memory/output 节点 |
| 4 | `nodes/ragNode.ts` | 新增 |
| 4 | `nodes/index.ts` | 修改：增加 ragNode 导出 |
| 4 | `engine/harnessGraph.ts` | 修改：集成 rag 节点 |
| 5 | `engine/harnessNodes.ts` | 修改：`routerNode` 使用真实 `Router` |
| 5 | `engine/harnessGraph.ts` | 修改：状态 Schema 增加 reasoning/confidence/targetAgent |
| 6 | `engine/harnessNodes.ts` | 修改：`buildEnrichedInput()` + Agent 节点注入上下文 |
| 7 | `observability/traceableNode.ts` | 新增 |
| 7 | `observability/index.ts` | 新增 |
| 7 | `engine/harnessGraph.ts` | 修改：所有节点包装 traceableNode |
| 8 | `engine/harnessGraph.ts` | 修改：修复 reactLoopRouter、简化图 traceableNode、新增 createProductionHarnessGraph |
| 9 | `server.ts` | 重写：从原生 http 改为 Koa 框架 |
| 9 | `Web/app/api/harness/route.ts` | 新增：前端 Next.js 代理 |
| 9 | `Web/app/api/chat/route.ts` | 修改：默认端口 3000 → 3001 |