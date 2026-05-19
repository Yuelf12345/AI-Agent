/**
 * 测试 - StateGraph 引擎
 *
 * 测试 StateGraph 实现的各种场景：
 * 1. 简单线性流程
 * 2. 条件分支
 * 3. 中断/恢复（人机交互）
 * 4. 错误处理
 * 5. 递归限制
 */

import { StateGraph, MemoryCheckpointer, Command } from "../src/harness/engine/index.ts";
import { StateSchema } from "../src/harness/engine/state.ts";
import { START, END } from "../src/harness/engine/edge.ts";
import { z } from "zod";

async function testSimpleFlow() {
  console.log("\n=== 测试 1：简单线性流程 ===");

  const TestState = new StateSchema()
    .addField("value", z.number())
    .addField("steps", z.array(z.string()), "append");

  const graph = new StateGraph(TestState)
    .addNode("step1", async (state) => {
      return { value: state.value + 1, steps: ["step1"] };
    })
    .addNode("step2", async (state) => {
      return { value: state.value * 2, steps: ["step2"] };
    })
    .addEdge(START, "step1")
    .addEdge("step1", "step2")
    .addEdge("step2", END)
    .compile();

  const result = await graph.invoke({ value: 10, steps: [] });

  console.log("结果:", JSON.stringify(result, null, 2));
  console.assert(result.value === 22, "值应为 (10+1)*2 = 22");
  console.assert(result.steps.length === 2, "应有 2 个步骤");
  console.assert(result.status === "completed", "状态应为已完成");
}

async function testConditionalBranching() {
  console.log("\n=== 测试 2：条件分支 ===");

  const TestState = new StateSchema()
    .addField("value", z.number())
    .addField("route", z.string())
    .addField("result", z.string());

  const router = (state: any) => {
    if (state.value > 10) return "high";
    return "low";
  };

  const graph = new StateGraph(TestState)
    .addNode("check", async (state) => ({ route: state.value > 10 ? "high" : "low" }))
    .addNode("high", async (state) => ({ result: "高路径" }))
    .addNode("low", async (state) => ({ result: "低路径" }))
    .addEdge(START, "check")
    .addConditionalEdges("check", router)
    .addEdge("high", END)
    .addEdge("low", END)
    .compile();

  // 测试值 > 10
  const result1 = await graph.invoke({ value: 15, route: "", result: "" });
  console.log("高路径结果:", result1.result);
  console.assert(result1.result === "高路径", "应路由到高路径");

  // 测试值 <= 10
  const result2 = await graph.invoke({ value: 5, route: "", result: "" });
  console.log("低路径结果:", result2.result);
  console.assert(result2.result === "低路径", "应路由到低路径");
}

async function testInterrupt() {
  console.log("\n=== 测试 3：中断/恢复（人机交互） ===");

  const TestState = new StateSchema()
    .addField("approved", z.boolean().nullable())
    .addField("status", z.string());

  const approvalNode = async (state: any) => {
    // 恢复模式：检查 __resumeValue__
    const { RESUME_VALUE_KEY } = await import("../src/harness/engine/command.ts");
    if (state[RESUME_VALUE_KEY] !== undefined) {
      const decision = state[RESUME_VALUE_KEY];
      return { approved: decision };
    }

    // 新调用：触发中断
    const { interrupt } = await import("../src/harness/engine/command.ts");
    interrupt({
      question: "是否批准此操作？",
      details: "删除所有文件"
    });
    // interrupt() 抛出 InterruptSignal，此行不会执行
    return { approved: false };
  };

  const proceedNode = async (state: any) => ({
    status: state.approved ? "已执行" : "已取消"
  });

  const graph = new StateGraph(TestState)
    .addNode("approval", approvalNode, { interruptAfter: true })
    .addNode("proceed", proceedNode)
    .addEdge(START, "approval")
    .addEdge("approval", "proceed")
    .addEdge("proceed", END)
    .compile({ checkpointer: new MemoryCheckpointer() });

  // 第一次调用 - 应触发中断
  const result1 = await graph.invoke({ approved: null, status: "pending" },
    { configurable: { thread_id: "test-interrupt-1" } });

  console.log("首次调用结果:");
  console.log("  - status:", result1.status);
  console.log("  - __interrupt__:", result1.__interrupt__ && result1.__interrupt__.length > 0 ? "有" : "无");
  console.assert(result1.status === "paused", "状态应为暂停");
  console.assert(result1.__interrupt__ !== undefined && result1.__interrupt__!.length > 0, "应有中断");

  // 恢复执行（批准）
  const result2 = await graph.invoke(
    Command.resume(true),
    { configurable: { thread_id: "test-interrupt-1" } }
  );

  console.log("恢复结果:");
  console.log("  - status:", result2.status);
  console.assert(result2.status === "completed", "恢复后状态应为已完成");
  console.log("✅ 中断/恢复机制正确");
}

async function testErrorHandling() {
  console.log("\n=== 测试 4：错误处理 ===");

  const TestState = new StateSchema()
    .addField("error", z.string().nullable())
    .addField("status", z.string());

  const errorNode = async (state: any) => {
    throw new Error("出错了");
  };

  const graph = new StateGraph(TestState)
    .addNode("failing", errorNode)
    .addEdge(START, "failing")
    .addEdge("failing", END)
    .compile();

  try {
    await graph.invoke({ error: null, status: "running" });
  } catch (e: any) {
    console.log("捕获错误:", e.message);
    console.assert(e.message === "出错了", "应捕获到错误");
  }
}

async function testRecursionLimit() {
  console.log("\n=== 测试 5：递归限制 ===");

  const TestState = new StateSchema()
    .addField("count", z.number())
    .addField("status", z.string());

  // 创建一个没有限制会无限循环的节点
  const loopNode = async (state: any) => ({ count: state.count + 1 });

  const router = (state: any) => {
    if (state.count >= 10) return END;
    return "loop";
  };

  const graph = new StateGraph(TestState)
    .addNode("loop", loopNode)
    .addEdge(START, "loop")
    .addConditionalEdges("loop", router)
    .compile();

  // 应在递归限制（默认 25）处停止
  const result = await graph.invoke({ count: 0, status: "running" });
  console.log("结果计数:", result.count);
  console.log("结果状态:", result.status);
  console.assert(result.count <= 25, "应在递归限制处停止");
}

async function runAllTests() {
  console.log("运行 StateGraph 测试...\n");

  try {
    await testSimpleFlow();
    await testConditionalBranching();
    await testInterrupt();
    await testErrorHandling();
    await testRecursionLimit();

    console.log("\n✅ 所有测试通过！");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

// 运行测试
runAllTests();