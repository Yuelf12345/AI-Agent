/**
 * 工具系统增强测试脚本
 * 
 * 测试 Retry / Timeout / Cache 三大增强功能：
 *   Step 1: Retry — 重试机制（指数退避）
 *   Step 2: Timeout — 超时控制
 *   Step 3: Cache — 缓存机制（LRU + TTL）
 *   Step 4: EnhancedToolRegistry — 完整集成
 * 
 * 运行方式：
 *   tsx src/Harness/test/test-tool-enhanced.ts
 */

import {
  withRetry,
  withTimeout,
  ToolCache,
  generateCacheKey,
  EnhancedToolRegistry,
} from "../src/harness/tools/enhancedTool.ts";

function separator(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ==================== Step 1: Retry ====================

async function testRetry() {
  separator("Step 1: Retry — 重试机制（指数退避）");

  // 模拟偶尔失败的服务
  let callCount = 0;
  const unreliableService = async (): Promise<string> => {
    callCount++;
    if (callCount < 3) {
      throw new Error(`Service unavailable (attempt ${callCount})`);
    }
    return `Success after ${callCount} attempts!`;
  };

  console.log("模拟不稳定服务（前2次失败，第3次成功）:");
  callCount = 0;
  const result = await withRetry(unreliableService, {
    maxRetries: 3,
    initialDelay: 200,    // 200ms（测试用，实际建议1000ms）
    backoffMultiplier: 2,
    maxDelay: 5000,
  });
  console.log(`  结果: ${result}`);
  console.log(`  总调用次数: ${callCount}`);

  // 不可重试的错误
  console.log("\n模拟不可重试的错误:");
  callCount = 0;
  const permissionDeniedService = async (): Promise<string> => {
    callCount++;
    throw new Error("Permission denied: unauthorized access");
  };

  try {
    await withRetry(permissionDeniedService, {
      maxRetries: 3,
      initialDelay: 100,
      retryableErrors: ["unavailable", "timeout"], // "permission" 不在列表中
    });
  } catch (error: any) {
    console.log(`  预期抛出: ${error.message}`);
    console.log(`  只调用了 ${callCount} 次（不重试不可重试的错误）`);
  }
}

// ==================== Step 2: Timeout ====================

async function testTimeout() {
  separator("Step 2: Timeout — 超时控制");

  // 正常完成（在超时前）
  console.log("快速完成的函数（100ms，超时200ms）:");
  const fastResult = await withTimeout(
    async () => {
      await new Promise(r => setTimeout(r, 100));
      return "Completed within timeout";
    },
    { timeoutMs: 200 },
  );
  console.log(`  结果: ${fastResult}`);

  // 超时的函数
  console.log("\n超时的函数（500ms，超时200ms）:");
  try {
    await withTimeout(
      async () => {
        await new Promise(r => setTimeout(r, 500));
        return "Should not reach here";
      },
      { timeoutMs: 200, timeoutMessage: "Operation timed out" },
    );
  } catch (error: any) {
    console.log(`  预期超时: ${error.message}`);
  }
}

// ==================== Step 3: Cache ====================

async function testCache() {
  separator("Step 3: Cache — 缓存机制（LRU + TTL）");

  const cache = new ToolCache<string>({ ttlMs: 2000, maxSize: 5 });

  // 存入缓存
  console.log("存入缓存:");
  cache.set("search:hash1", "搜索结果1");
  cache.set("search:hash2", "搜索结果2");
  cache.set("readFile:hash3", "文件内容3");
  console.log(`  缓存大小: ${cache.getStats().size}`);

  // 获取缓存
  console.log("\n获取缓存:");
  const cached = cache.get("search:hash1");
  console.log(`  search:hash1 → ${cached}`);
  cache.recordHit();

  // 缓存未命中
  const notFound = cache.get("search:hash_notexist");
  console.log(`  search:hash_notexist → ${notFound}`);
  cache.recordMiss();

  // TTL 过期
  console.log("\n等待缓存过期（2秒）...");
  await new Promise(r => setTimeout(r, 2100));
  const expired = cache.get("search:hash1");
  console.log(`  search:hash1 (过期后) → ${expired}`);

  // 命中率统计
  console.log("\n命中率统计:");
  const stats = cache.getStats();
  console.log(`  命中: ${stats.hitRate > 0 ? "有" : "无"}, 大小: ${stats.size}/${stats.maxSize}`);

  // LRU 淘汰
  console.log("\nLRU 淘汰测试（maxSize=5）:");
  cache.clear();
  for (let i = 1; i <= 7; i++) {
    cache.set(`key_${i}`, `value_${i}`);
  }
  console.log(`  存入7条后缓存大小: ${cache.getStats().size}（淘汰了最旧的2条）`);
  console.log(`  key_1: ${cache.get("key_1")}（已被淘汰）`);
  console.log(`  key_6: ${cache.get("key_6")}（仍然存在）`);

  // 缓存键生成
  console.log("\n缓存键生成:");
  const key1 = generateCacheKey("search", { query: "RAG" });
  const key2 = generateCacheKey("search", { query: "RAG" });
  const key3 = generateCacheKey("search", { query: "LangChain" });
  console.log(`  相同参数 → 相同键: ${key1 === key2}`);
  console.log(`  不同参数 → 不同键: ${key1 !== key3}`);
}

// ==================== Step 4: EnhancedToolRegistry ====================

async function testEnhancedRegistry() {
  separator("Step 4: EnhancedToolRegistry — 完整集成");
  console.log("⚠️ 此步骤展示增强工具注册器的使用方式\n");

  // 模拟一个简单工具（不依赖 BaseTool 的完整实现）
  const registry = new EnhancedToolRegistry();

  // 模拟工具调用场景
  console.log("模拟场景：调用搜索工具（带重试+超时+缓存）\n");

  // 模拟调用带增强配置
  let searchCallCount = 0;

  // 直接测试 withRetry + withTimeout + Cache 组合
  const cache = new ToolCache<string>({ ttlMs: 5000 });

  // 第一次调用（无缓存）
  console.log("第1次调用:");
  const cacheKey = generateCacheKey("search", { query: "RAG" });

  if (cache.has(cacheKey)) {
    console.log("  → 缓存命中（跳过执行）");
  } else {
    const execute = async () => {
      searchCallCount++;
      await new Promise(r => setTimeout(r, 50));
      return `找到3篇关于RAG的文档（调用次数: ${searchCallCount}）`;
    };

    const result = await withRetry(
      async () => withTimeout(execute, { timeoutMs: 5000 }),
      { maxRetries: 2, initialDelay: 100 },
    );

    cache.set(cacheKey, result);
    console.log(`  → 执行结果: ${result}`);
  }

  // 第二次调用（有缓存）
  console.log("\n第2次调用（相同参数）:");
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`  → 缓存命中: ${cachedResult}`);
  } else {
    console.log("  → 缓存未命中，需要重新执行");
  }

  console.log("\n缓存统计:");
  console.log(`  大小: ${cache.getStats().size}`);
}

// ==================== Main ====================

async function main() {
  console.log("=== 工具系统增强测试 ===\n");
  console.log("三大增强功能:");
  console.log("  1. Retry — 失败自动重试（指数退避）");
  console.log("  2. Timeout — 超时自动取消（防止阻塞）");
  console.log("  3. Cache — 相同参数返回缓存（LRU + TTL）");

  await testRetry();
  await testTimeout();
  await testCache();
  await testEnhancedRegistry();

  console.log("\n=== 工具增强总结 ===");
  console.log("调用流程: Cache检查 → Timeout包裹 → Retry包裹 → 执行 → Cache存储");
  console.log("Retry: 失败后指数退避重试，可配置可重试错误类型");
  console.log("Timeout: Promise.race 实现，超时自动取消");
  console.log("Cache: LRU淘汰 + TTL过期，减少重复调用");
}

main().catch(console.error);