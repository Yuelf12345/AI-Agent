/**
 * Tracing - 链路追踪系统
 * 
 * 核心概念：
 *   链路追踪模拟分布式系统中的请求追踪能力。
 *   每次请求被分解为多个"Span"（时间片段），记录：
 *   - 操作名称（span name）
 *   - 开始/结束时间
 *   - 父子关系（parent-child）
 *   - 标签（tags）— 关键信息
 *   - 日志（logs）— 事件记录
 * 
 * 典型追踪流程：
 *   ┌──────────────┐
 *   │  handleRequest │ ← Root Span
 *   └──────┬─────────┘
 *          │
 *    ┌─────┴─────┐
 *    │           │
 * ┌──▼────┐  ┌──▼────┐
 * │  LLM  │  │ RAG   │ ← Child Spans
 * │ call  │  │ search│
 * └───────┘  └───────┘
 * 
 * 使用方式：
 *   const tracer = new Tracer();
 *   const span = tracer.startSpan("query");
 *   // ... 执行操作 ...
 *   span.end();
 *   console.log(tracer.getTrace());
 */

export interface SpanContext {
  traceId: string;   // 全局追踪 ID
  spanId: string;   // 当前 Span ID
  parentId?: string; // 父 Span ID
}

export interface SpanTag {
  key: string;
  value: string | number | boolean;
}

export interface SpanLog {
  timestamp: number;
  message: string;
  fields?: Record<string, any>;
}

export interface Span {
  name: string;
  context: SpanContext;
  startTime: number;
  endTime?: number;
  tags: SpanTag[];
  logs: SpanLog[];
  status: "ok" | "error";
}

/**
 * 追踪器
 * 
 * 管理整个请求的生命周期：
 *   - 生成 traceId
 *   - 创建/结束 spans
 *   - 收集追踪数据
 *   - 导出追踪结果
 */
export class Tracer {
  private spans: Span[] = [];
  private currentSpan: Span | null = null;
  private traceId: string;

  constructor() {
    this.traceId = this._generateId();
  }

  /**
   * 开始一个 Span
   * 
   * @param name Span 名称（如 "llm.call", "rag.retrieve"）
   * @param tags 初始标签
   */
  startSpan(name: string, tags?: SpanTag[]): Span {
    const parentId = this.currentSpan?.context.spanId;
    const context: SpanContext = {
      traceId: this.traceId,
      spanId: this._generateId(),
    };
    if (parentId !== undefined) {
      context.parentId = parentId;
    }
    
    const span: Span = {
      name,
      context,
      startTime: Date.now(),
      tags: tags || [],
      logs: [],
      status: "ok",
    };

    this.spans.push(span);
    this.currentSpan = span;

    return span;
  }

  /**
   * 结束当前 Span
   */
  endSpan(): void {
    if (this.currentSpan) {
      this.currentSpan.endTime = Date.now();
      this.currentSpan = this.spans.find(
        s => s.context.spanId === this.currentSpan?.context.parentId
      ) || null;
    }
  }

  /**
   * 为当前 Span 添加标签
   */
  addTag(key: string, value: string | number | boolean): void {
    if (this.currentSpan) {
      this.currentSpan.tags.push({ key, value });
    }
  }

  /**
   * 为当前 Span 添加日志事件
   */
  addLog(message: string, fields?: Record<string, any>): void {
    if (this.currentSpan) {
      const logEntry: SpanLog = {
        timestamp: Date.now(),
        message,
      };
      if (fields !== undefined) {
        logEntry.fields = fields;
      }
      this.currentSpan.logs.push(logEntry);
    }
  }

  /**
   * 标记 Span 为错误状态
   */
  setError(error: Error): void {
    if (this.currentSpan) {
      this.currentSpan.status = "error";
      this.addTag("error", true);
      this.addLog("Error occurred", {
        message: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * 获取整个追踪树
   */
  getTrace(): Span[] {
    return [...this.spans];
  }

  /**
   * 获取追踪统计
   */
  getSummary(): {
    traceId: string;
    spanCount: number;
    duration: number;
    errorCount: number;
  } {
    const errorCount = this.spans.filter(s => s.status === "error").length;
    const firstSpan = this.spans[0];
    const lastSpan = this.spans[this.spans.length - 1];
    const duration = this.spans.length > 0 && firstSpan && lastSpan
      ? (lastSpan.endTime || Date.now()) - firstSpan.startTime
      : 0;

    return {
      traceId: this.traceId,
      spanCount: this.spans.length,
      duration,
      errorCount,
    };
  }

  /**
   * 格式化追踪为文本（用于日志输出）
   */
  formatTrace(): string {
    const lines: string[] = [];
    const summary = this.getSummary();

    lines.push(`[Trace ${this.traceId}] ${summary.spanCount} spans, ${summary.duration}ms, ${summary.errorCount} errors`);

    for (const span of this.spans) {
      const duration = span.endTime ? span.endTime - span.startTime : 0;
      const indent = span.context.parentId ? "  " : "";
      const status = span.status === "error" ? "❌" : "✓";

      lines.push(`${indent}${status} ${span.name} (${duration}ms)`);

      // 显示标签
      for (const tag of span.tags.slice(0, 3)) {
        lines.push(`${indent}  ${tag.key}: ${tag.value}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 生成随机 ID
   */
  private _generateId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * 重置追踪器
   */
  reset(): void {
    this.spans = [];
    this.currentSpan = null;
    this.traceId = this._generateId();
  }
}

/**
 * 全局追踪器实例
 */
export const globalTracer = new Tracer();

/**
 * 追踪装饰器 — 自动追踪函数执行
 * 
 * 使用方式：
 *   const tracer = new Tracer();
 *   
 *   // 方式1: 使用全局追踪器
 *   @traceable("my.operation")
 *   async function myOperation() { ... }
 * 
 *   // 方式2: 手动传递追踪器
 *   const span = tracer.startSpan("op");
 *   // ... do work ...
 *   tracer.endSpan();
 */
export function traceable(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const span = globalTracer.startSpan(name);
      span.tags.push({ key: "function", value: propertyKey });

      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error: any) {
        globalTracer.setError(error);
        throw error;
      } finally {
        globalTracer.endSpan();
      }
    };

    return descriptor;
  };
}