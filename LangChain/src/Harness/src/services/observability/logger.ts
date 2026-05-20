/**
 * Logger - 结构化日志系统
 * 
 * 核心概念：
 *   结构化日志是现代应用监控的基础。相比传统的自由文本日志，
 *   结构化日志将日志内容组织为键值对，便于：
 *   - 搜索过滤
 *   - 统计分析
 *   - 可视化展示
 * 
 * 日志级别：
 *   DEBUG < INFO < WARN < ERROR < FATAL
 * 
 * 日志格式：
 *   {
 *     "timestamp": "2024-01-15T10:30:00.000Z",
 *     "level": "INFO",
 *     "message": "LLM request completed",
 *     "context": { "model": "gpt-4", "latency": 1200 },
 *     "traceId": "abc123"
 *   }
 * 
 * 使用方式：
 *   const logger = new Logger();
 *   
 *   logger.info("LLM request completed", { model: "gpt-4", latency: 1200 });
 *   logger.error("Request failed", { error: error.message });
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  traceId?: string;
  spanId?: string;
}

export interface LoggerConfig {
  /** 最小日志级别 */
  minLevel: LogLevel;
  /** 是否输出到控制台 */
  console: boolean;
  /** 是否输出到文件 */
  file: boolean;
  /** 文件路径（如果 file=true） */
  filePath?: string;
  /** 是否包含时间戳 */
  timestamp: boolean;
  /** 是否包含调用位置 */
  caller: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: "info",
  console: true,
  file: false,
  timestamp: true,
  caller: false,
};

// 日志级别优先级
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * 结构化日志记录器
 */
export class Logger {
  private config: LoggerConfig;
  private logs: LogEntry[] = [];
  private traceId: string | undefined;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置当前追踪 ID（自动注入到所有日志）
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  /**
   * 清除追踪 ID
   */
  clearTraceId(): void {
    this.traceId = undefined;
  }

  /**
   * 调试日志
   */
  debug(message: string, context?: Record<string, any>): void {
    this._log("debug", message, context);
  }

  /**
   * 信息日志
   */
  info(message: string, context?: Record<string, any>): void {
    this._log("info", message, context);
  }

  /**
   * 警告日志
   */
  warn(message: string, context?: Record<string, any>): void {
    this._log("warn", message, context);
  }

  /**
   * 错误日志
   */
  error(message: string, context?: Record<string, any>): void {
    this._log("error", message, context);
  }

  /**
   * 致命错误日志
   */
  fatal(message: string, context?: Record<string, any>): void {
    this._log("fatal", message, context);
  }

  /**
   * 内部日志方法
   */
  private _log(level: LogLevel, message: string, context?: Record<string, any>): void {
    // 过滤低级别日志
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: this.config.timestamp ? new Date().toISOString() : "",
      level,
      message,
    };
    if (context !== undefined) {
      entry.context = context;
    }
    if (this.traceId !== undefined) {
      entry.traceId = this.traceId;
    }

    this.logs.push(entry);

    // 输出到控制台
    if (this.config.console) {
      this._outputToConsole(entry);
    }

    // 输出到文件
    if (this.config.file && this.config.filePath) {
      this._outputToFile(entry);
    }
  }

  /**
   * 输出到控制台（带颜色）
   */
  private _outputToConsole(entry: LogEntry): void {
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[90m",   // 灰色
      info: "\x1b[32m",    // 绿色
      warn: "\x1b[33m",    // 黄色
      error: "\x1b[31m",   // 红色
      fatal: "\x1b[35m",   // 紫色
    };

    const reset = "\x1b[0m";
    const color = colors[entry.level];

    let line = `${color}[${entry.level.toUpperCase()}]${reset}`;
    if (entry.timestamp) {
      line += ` ${entry.timestamp.slice(11, 23)}`; // 只显示时间部分
    }
    if (entry.traceId) {
      line += ` [${entry.traceId.slice(0, 6)}]`;
    }
    line += ` ${entry.message}`;

    if (entry.context) {
      line += ` ${JSON.stringify(entry.context)}`;
    }

    // 根据级别使用不同的 console 方法
    switch (entry.level) {
      case "debug":
        console.debug(line);
        break;
      case "info":
        console.info(line);
        break;
      case "warn":
        console.warn(line);
        break;
      case "error":
      case "fatal":
        console.error(line);
        break;
      default:
        console.log(line);
    }
  }

  /**
   * 输出到文件
   */
  private async _outputToFile(entry: LogEntry): Promise<void> {
    // 简化实现：实际项目中应使用 fs.appendFile
    // 这里仅作演示
    const fs = await import("fs/promises");
    const line = JSON.stringify(entry) + "\n";

    try {
      await fs.appendFile(this.config.filePath!, line);
    } catch (error) {
      console.error("Failed to write log to file:", error);
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 按级别过滤日志
   */
  filterByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(
      log => LEVEL_PRIORITY[log.level] >= LEVEL_PRIORITY[level]
    );
  }

  /**
   * 按追踪 ID 过滤日志
   */
  filterByTraceId(traceId: string): LogEntry[] {
    return this.logs.filter(log => log.traceId === traceId);
  }

  /**
   * 搜索日志
   */
  search(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.logs.filter(
      log =>
        log.message.toLowerCase().includes(lowerQuery) ||
        JSON.stringify(log.context).toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 导出为 JSON Lines 格式
   */
  toJSONLines(): string {
    return this.logs.map(log => JSON.stringify(log)).join("\n");
  }

  /**
   * 清除日志
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * 创建子日志器（继承配置但有独立日志列表）
   */
  child(): Logger {
    const child = new Logger(this.config);
    child.traceId = this.traceId ?? undefined;
    return child;
  }
}

/**
 * 全局日志器（输出到控制台 + log 文件）
 */
export const globalLogger = new Logger({
  console: true,
  file: true,
  filePath: "logs/harness.jsonl",
  minLevel: "info",
  timestamp: true,
});

// 便捷方法
export const log = {
  debug: (msg: string, ctx?: Record<string, any>) => globalLogger.debug(msg, ctx),
  info: (msg: string, ctx?: Record<string, any>) => globalLogger.info(msg, ctx),
  warn: (msg: string, ctx?: Record<string, any>) => globalLogger.warn(msg, ctx),
  error: (msg: string, ctx?: Record<string, any>) => globalLogger.error(msg, ctx),
  fatal: (msg: string, ctx?: Record<string, any>) => globalLogger.fatal(msg, ctx),
};