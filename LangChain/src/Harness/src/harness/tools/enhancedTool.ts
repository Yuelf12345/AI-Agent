/**
 * 工具系统增强 — Retry / Timeout / Cache
 * 
 * 三大增强功能：
 * 
 *   1. Retry（重试机制）
 *      - 工具调用失败时自动重试
 *      - 指数退避策略：间隔逐渐增大
 *      - 可配置最大重试次数和可重试的错误类型
 * 
 *   2. Timeout（超时控制）
 *      - 防止工具长时间阻塞
 *      - 超时后自动取消并返回错误
 *      - 不同工具可设置不同超时时间
 * 
 *   3. Cache（缓存机制）
 *      - 相同参数的调用返回缓存结果
 *      - TTL 过期后自动失效
 *      - 减少重复调用，降低延迟和成本
 * 
 * 使用方式：
 *   const registry = new EnhancedToolRegistry();
 *   registry.register(tool, { retry: 3, timeout: 5000, cache: 60000 });
 *   const result = await registry.invoke(toolCall);
 */

// ==================== Retry 重试机制 ====================

export interface RetryConfig {
  /** 最大重试次数（默认 3） */
  maxRetries: number;
  /** 初始退避间隔 ms（默认 1000） */
  initialDelay: number;
  /** 退避倍数（默认 2，即每次间隔翻倍） */
  backoffMultiplier: number;
  /** 最大退避间隔 ms（默认 10000） */
  maxDelay: number;
  /** 可重试的错误类型（默认全部） */
  retryableErrors?: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 10000,
};

/**
 * 带重试的函数执行
 * 
 * 指数退避策略：
 *   第1次重试: delay = initialDelay (1s)
 *   第2次重试: delay = initialDelay × backoffMultiplier (2s)
 *   第3次重试: delay = initialDelay × backoffMultiplier² (4s)
 * 
 * @param fn 要执行的函数
 * @param config 重试配置
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // 检查是否可重试
      if (!isRetryable(error, finalConfig.retryableErrors)) {
        throw error;
      }

      // 最后一次不等待
      if (attempt < finalConfig.maxRetries) {
        const delay = Math.min(
          finalConfig.initialDelay * Math.pow(finalConfig.backoffMultiplier, attempt),
          finalConfig.maxDelay,
        );
        console.log(`[Retry] Attempt ${attempt + 1}/${finalConfig.maxRetries} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * 判断错误是否可重试
 */
function isRetryable(error: Error, retryableErrors?: string[]): boolean {
  if (!retryableErrors) return true; // 默认全部可重试

  const errorMsg = error.message.toLowerCase();
  return retryableErrors.some(errType => errorMsg.includes(errType.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Timeout 超时控制 ====================

export interface TimeoutConfig {
  /** 超时时间 ms（默认 30000） */
  timeoutMs: number;
  /** 超时时的错误消息 */
  timeoutMessage: string;
}

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  timeoutMs: 30000,
  timeoutMessage: "Tool execution timed out",
};

/**
 * 带超时的函数执行
 * 
 * 原理：使用 Promise.race，让执行和超时计时器竞争：
 *   - 如果执行先完成 → 返回结果
 *   - 如果计时器先触发 → 抛出超时错误
 * 
 * @param fn 要执行的函数
 * @param config 超时配置
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  config?: Partial<TimeoutConfig>,
): Promise<T> {
  const finalConfig = { ...DEFAULT_TIMEOUT_CONFIG, ...config };

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${finalConfig.timeoutMessage} (${finalConfig.timeoutMs}ms)`));
    }, finalConfig.timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

// ==================== Cache 缓存机制 ====================

export interface CacheConfig {
  /** 缓存过期时间 ms（默认 60000 = 1分钟） */
  ttlMs: number;
  /** 最大缓存条目数（默认 100） */
  maxSize: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttlMs: 60000,
  maxSize: 100,
};

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * LRU 缓存器
 * 
 * 特点：
 *   - TTL 过期自动失效
 *   - 超出 maxSize 时淘汰最旧的条目
 *   - 基于参数哈希作为缓存键
 * 
 * 使用方式：
 *   const cache = new ToolCache<string>({ ttlMs: 60000 });
 *   cache.set("tool_name:param_hash", "result");
 *   const cached = cache.get("tool_name:param_hash");
 */
export class ToolCache<T> {
  private config: CacheConfig;
  private entries: Map<string, CacheEntry<T>> = new Map();

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * 获取缓存
   * 
   * 如果缓存存在且未过期，返回缓存值。
   * 否则返回 null。
   */
  get(key: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) return null;

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * 设置缓存
   */
  set(key: string, value: T): void {
    // 如果超出容量，淘汰最旧的
    if (this.entries.size >= this.config.maxSize) {
      this._evictOldest();
    }

    this.entries.set(key, {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
    });
  }

  /**
   * 检查缓存是否存在且未过期
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * 清除过期缓存
   */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        purged++;
      }
    }

    return purged;
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.entries.size,
      maxSize: this.config.maxSize,
      hitRate: this._hits / (this._hits + this._misses) || 0,
    };
  }

  private _hits: number = 0;
  private _misses: number = 0;

  /** 记录命中 */
  recordHit(): void {
    this._hits++;
  }

  /** 记录未命中 */
  recordMiss(): void {
    this._misses++;
  }

  /** 淘汰最旧的条目 */
  private _evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }
}

/**
 * 生成缓存键
 * 
 * 基于 tool name + params 生成唯一哈希
 */
export function generateCacheKey(toolName: string, params: Record<string, any>): string {
  const paramsStr = JSON.stringify(params);
  // 简易哈希（生产环境应使用更可靠的哈希算法）
  const hash = paramsStr.split("").reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return `${toolName}:${hash}`;
}

// ==================== ToolCallConfig 统一配置 ====================

/**
 * 单个工具的增强配置
 */
export interface ToolCallConfig {
  /** 重试配置 */
  retry?: Partial<RetryConfig>;
  /** 超时配置 */
  timeout?: Partial<TimeoutConfig>;
  /** 缓存配置 */
  cache?: Partial<CacheConfig>;
  /** 是否启用缓存 */
  enableCache?: boolean;
}

// ==================== EnhancedToolRegistry ====================

import { BaseTool } from "../tools/baseTool.ts";
import type { ToolResult } from "../../types/index.ts";

/**
 * 增强版工具注册器
 * 
 * 继承 ToolRegistry 的基础功能，增加：
 *   - 调用前自动超时控制
 *   - 失败后自动重试
 *   - 相同参数返回缓存结果
 * 
 * 使用方式：
 *   const registry = new EnhancedToolRegistry();
 *   registry.register(tool, { retry: { maxRetries: 3 }, timeout: { timeoutMs: 5000 }, enableCache: true });
 *   
 *   const result = await registry.invoke({ name: "search", parameters: { query: "RAG" } });
 */
export class EnhancedToolRegistry {
  private tools: Map<string, BaseTool<any>> = new Map();
  private configs: Map<string, ToolCallConfig> = new Map();
  private cache: ToolCache<string>;

  constructor() {
    this.cache = new ToolCache<string>({ ttlMs: 60000, maxSize: 200 });
  }

  /**
   * 注册工具及其增强配置
   */
  register(tool: BaseTool<any>, config?: ToolCallConfig): void {
    this.tools.set(tool.name, tool);
    if (config) {
      this.configs.set(tool.name, config);
    }
    console.log(`[EnhancedToolRegistry] Registered: ${tool.name}`);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: BaseTool<any>[], defaultConfig?: ToolCallConfig): void {
    for (const tool of tools) {
      this.register(tool, defaultConfig);
    }
  }

  /**
   * 增强版工具调用
   * 
   * 流程：
   *   1. 检查缓存 → 有缓存直接返回
   *   2. 超时控制 → withTimeout 包裹执行
   *   3. 重试机制 → withRetry 包裹执行
   *   4. 缓存结果 → 存入缓存供下次使用
   */
  async invoke(toolCall: { name: string; parameters: Record<string, any> }): Promise<string> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return `Error: Tool "${toolCall.name}" not found`;
    }

    const config = this.configs.get(toolCall.name) || {};

    // 1. 检查缓存
    if (config.enableCache) {
      const cacheKey = generateCacheKey(toolCall.name, toolCall.parameters);
      const cached = this.cache.get(cacheKey);

      if (cached !== null) {
        this.cache.recordHit();
        console.log(`[EnhancedToolRegistry] Cache hit: ${toolCall.name}`);
        return cached;
      }
      this.cache.recordMiss();
    }

    // 2. 构建增强执行函数
    const execute = async (): Promise<string> => {
      return await tool.call(toolCall.parameters);
    };

    // 3. 依次应用增强策略
    let enhancedExecute = execute;

    // 超时控制
    if (config.timeout) {
      enhancedExecute = async () => withTimeout(enhancedExecute, config.timeout);
    }

    // 重试机制
    if (config.retry) {
      enhancedExecute = async () => withRetry(enhancedExecute, config.retry);
    }

    // 4. 执行
    try {
      const result = await enhancedExecute();

      // 5. 缓存结果
      if (config.enableCache) {
        const cacheKey = generateCacheKey(toolCall.name, toolCall.parameters);
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  /** 获取工具 */
  get(name: string): BaseTool<any> | undefined {
    return this.tools.get(name);
  }

  /** 获取所有工具 */
  getAllTools(): BaseTool<any>[] {
    return Array.from(this.tools.values());
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return this.cache.getStats();
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 清除过期缓存 */
  purgeExpiredCache(): number {
    return this.cache.purgeExpired();
  }
}