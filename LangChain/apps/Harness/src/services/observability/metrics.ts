/**
 * Metrics - 指标统计系统
 * 
 * 核心概念：
 *   Metrics 收集 AI 应用的运行时指标，帮助监控和优化性能。
 *   本模块提供四类核心指标：
 * 
 *   1. Counter（计数器）— 只增不减
 *      示例：总请求数、LLM 调用次数、错误次数
 * 
 *   2. Gauge（仪表）— 可增可减
 *      示例：当前活跃请求数、内存使用量
 * 
 *   3. Histogram（直方图）— 分布统计
 *      示例：延迟分布、Token 消耗分布
 * 
 *   4. Timer（计时器）— 耗时统计
 *      示例：LLM 调用耗时、RAG 检索耗时
 * 
 * 使用方式：
 *   const metrics = new Metrics();
 *   
 *   // 计数器
 *   metrics.incrementCounter("llm.requests.total");
 *   
 *   // 延迟直方图
 *   const timer = metrics.timer("llm.latency");
 *   await llm.call();
 *   timer.end();
 *   
 *   // 获取统计
 *   console.log(metrics.getStats("llm.latency"));
 */

export type MetricType = "counter" | "gauge" | "histogram" | "timer";

export interface MetricValue {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface HistogramStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface TimerContext {
  name: string;
  labels: Record<string, string>;
  startTime: number;
}

/**
 * 指标收集器
 */
export class Metrics {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private timers: Map<string, number[]> = new Map();
  private activeTimers: Map<string, TimerContext> = new Map();

  /**
   * 递增计数器
   * 
   * @param name 指标名称（如 "llm.requests.total"）
   * @param delta 增量（默认 1）
   * @param labels 标签（如 { model: "gpt-4" }）
   */
  incrementCounter(name: string, delta: number = 1, labels?: Record<string, string>): void {
    const key = this._makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + delta);
  }

  /**
   * 设置仪表值
   * 
   * @param name 指标名称
   * @param value 值
   * @param labels 标签
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this._makeKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * 记录直方图值
   * 
   * @param name 指标名称
   * @param value 值（如延迟毫秒数）
   * @param labels 标签
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this._makeKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  /**
   * 开始计时器
   * 
   * @param name 指标名称
   * @param labels 标签
   * @returns 计时器上下文（用于 endTimer）
   */
  startTimer(name: string, labels?: Record<string, string>): TimerContext {
    const key = this._makeKey(name, labels);
    const context: TimerContext = {
      name: key,
      labels: labels || {},
      startTime: Date.now(),
    };
    this.activeTimers.set(key, context);
    return context;
  }

  /**
   * 结束计时器（自动记录耗时）
   * 
   * @param nameOrContext 计时器名称或上下文
   */
  endTimer(nameOrContext: string | TimerContext): void {
    const context = typeof nameOrContext === "string"
      ? this.activeTimers.get(nameOrContext)
      : nameOrContext;

    if (!context) return;

    const duration = Date.now() - context.startTime;
    this.recordHistogram(context.name, duration, context.labels);
    this.activeTimers.delete(context.name);
  }

  /**
   * 便捷方法：计时并执行 async 函数
   * 
   * @param name 指标名称
   * @param fn 要执行的函数
   * @param labels 标签
   */
  async timed<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T> {
    const timer = this.startTimer(name, labels);
    try {
      return await fn();
    } finally {
      this.endTimer(timer);
    }
  }

  /**
   * 获取计数器值
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this._makeKey(name, labels);
    return this.counters.get(key) || 0;
  }

  /**
   * 获取仪表值
   */
  getGauge(name: string, labels?: Record<string, string>): number | undefined {
    const key = this._makeKey(name, labels);
    return this.gauges.get(key);
  }

  /**
   * 获取直方图统计
   */
  getHistogramStats(name: string, labels?: Record<string, string>): HistogramStats | null {
    const key = this._makeKey(name, labels);
    const values = this.histograms.get(key);

    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      sum,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      mean: sum / count,
      p50: sorted[Math.floor(count * 0.5)]!,
      p90: sorted[Math.floor(count * 0.9)]!,
      p95: sorted[Math.floor(count * 0.95)]!,
      p99: sorted[Math.floor(count * 0.99)]!,
    };
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): MetricValue[] {
    const metrics: MetricValue[] = [];
    const now = Date.now();

    // Counters
    for (const [key, value] of this.counters) {
      const { name, labels } = this._parseKey(key);
      metrics.push({ name, type: "counter", value, labels, timestamp: now });
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      const { name, labels } = this._parseKey(key);
      metrics.push({ name, type: "gauge", value, labels, timestamp: now });
    }

    // Histograms
    for (const [key, values] of this.histograms) {
      const { name, labels } = this._parseKey(key);
      const stats = this.getHistogramStats(name, labels);
      if (stats) {
        metrics.push({ name, type: "histogram", value: stats.mean, labels, timestamp: now });
      }
    }

    return metrics;
  }

  /**
   * 导出为 Prometheus 格式
   */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const metric of this.getAllMetrics()) {
      const labels = Object.entries(metric.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");

      const labelStr = labels ? `{${labels}}` : "";
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      lines.push(`${metric.name}${labelStr} ${metric.value}`);
    }

    return lines.join("\n");
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.activeTimers.clear();
  }

  // ==================== 便捷方法 ====================

  /** 记录 LLM 调用 */
  recordLLMCall(model: string, latencyMs: number, tokens?: number): void {
    this.incrementCounter("llm.requests.total", 1, { model });
    this.recordHistogram("llm.latency", latencyMs, { model });
    if (tokens) {
      this.recordHistogram("llm.tokens", tokens, { model });
    }
  }

  /** 记录 RAG 检索 */
  recordRAGRetrieval(latencyMs: number, resultCount: number): void {
    this.incrementCounter("rag.retrievals.total");
    this.recordHistogram("rag.retrieval.latency", latencyMs);
    this.recordHistogram("rag.retrieval.results", resultCount);
  }

  /** 记录错误 */
  recordError(type: string): void {
    this.incrementCounter("errors.total", 1, { type });
  }

  // ==================== 内部方法 ====================

  private _makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  private _parseKey(key: string): { name: string; labels: Record<string, string> } {
    const match = key.match(/^(.+?)\{(.*)\}$/);
    if (!match) return { name: key, labels: {} };

    const name = match[1] ?? key;
    const labels: Record<string, string> = {};
    const labelPairs = match[2]?.matchAll(/(\w+)="([^"]*)"/g);

    if (labelPairs) {
      for (const pair of labelPairs) {
        if (pair[1] && pair[2]) {
          labels[pair[1]] = pair[2];
        }
      }
    }

    return { name, labels };
  }
}

/**
 * 全局指标实例
 */
export const globalMetrics = new Metrics();