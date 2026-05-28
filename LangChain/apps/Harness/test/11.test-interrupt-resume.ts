/**
 * 测试 - StateGraph interrupt/resume 传值机制
 *
 * 验证修复后的核心功能：
 * 1. interrupt() 抛出 InterruptSignal，中断执行
 * 2. Command.resume(value) 恢复时，resumeValue 通过 state.__resumeValue__ 传递
 * 3. 节点函数通过检查 __resumeValue__ 获取恢复值
 * 4. interruptAfter 恢复时跳过已完成节点
 * 5. interruptBefore 恢复时执行节点
 * 6. ApprovalGate 集成：审批/拒绝/修改
 */

import { StateGraph, MemoryCheckpointer, Command } from "../src/harness/engine/index.ts";
import { RESUME_VALUE_KEY, INTERRUPT_TYPE_KEY } from "../src/harness/engine/command.ts";
import { StateSchema } from "../src/harness/engine/state.ts";
import { START, END } from "../src/harness/engine/edge.ts";
import { z } from "zod";

// ==================== 测试 1：__resumeValue__ 传值 ====================

async function testResumeValuePassing() {
  console.log("\n=== 测试 1：__resumeValue__ 传值 ===");

  const TestState = new StateSchema()
    .addField("approved", z.boolean().nullable())
    .addField("status", z.string());

  // 节点函数：检查 __resumeValue__ 获取恢复值
  const approvalNode = async (state: any) => {
    // 恢复模式：检查 __resumeValue__
    if (state[RESUME_VALUE_KEY] !== undefined) {
      const decision = state[RESUME_VALUE_KEY];
      console.log(`  [approvalNode] 恢复值: ${decision}`);
      return { approved: decision, status: "reviewed" };
    }

    // 新调用：触发中断
    console.log(`  [approvalNode] 触发 interrupt`);
    const { interrupt } = await import("../src/harness/engine/command.ts");
    interrupt({ question: "是否批准此操作？", details: "删除所有文件" });
    // 此行不会执行
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
    { configurable: { thread_id: "test-resume-1" } });

  console.log("首次调用:");
  console.log(`  - status: ${result1.status}`);
  console.log(`  - __interrupt__: ${result1.__interrupt__ ? "有" : "无"}`);
  console.assert(result1.status === "paused", "状态应为 paused");
  console.assert(result1.__interrupt__ !== undefined && result1.__interrupt__!.length > 0, "应有中断");

  // 恢复执行（批准） - resumeValue 应传递到节点
  const result2 = await graph.invoke(
    Command.resume(true),
    { configurable: { thread_id: "test-resume-1" } }
  );

  console.log("恢复结果:");
  console.log(`  - status: ${result2.status}`);
  console.log(`  - approved: ${result2.approved}`);
  console.assert(result2.status === "completed", "恢复后状态应为 completed");
  console.assert(result2.approved === true, "恢复值 true 应传递到 approved 字段");

  // 测试拒绝
  const result3 = await graph.invoke({ approved: null, status: "pending" },
    { configurable: { thread_id: "test-resume-2" } });

  const result4 = await graph.invoke(
    Command.resume(false),
    { configurable: { thread_id: "test-resume-2" } }
  );

  console.log("拒绝结果:");
  console.log(`  - approved: ${result4.approved}`);
  console.assert(result4.approved === false, "恢复值 false 应传递到 approved 字段");
  console.log("✅ __resumeValue__ 传值机制正确");
}

// ==================== 测试 2：interruptAfter 恢复跳过已完成节点 ====================

async function testInterruptAfterSkipNode() {
  console.log("\n=== 测试 2：interruptAfter 恢复跳过已完成节点 ===");

  const TestState = new StateSchema()
    .addField("value", z.number())
    .addField("steps", z.array(z.string()), "append")
    .addField("status", z.string());

  // 节点1：正常执行（值+1）
  const addNode = async (state: any) => {
    return { value: state.value + 1, steps: ["add"] };
  };

  // 节点2：执行后中断
  const doubleNode = async (state: any) => {
    return { value: state.value * 2, steps: ["double"] };
  };

  // 节点3：最终处理
  const finalNode = async (state: any) => ({
    status: "completed"
  });

  const graph = new StateGraph(TestState)
    .addNode("add", addNode)
    .addNode("double", doubleNode, { interruptAfter: true })
    .addNode("final", finalNode)
    .addEdge(START, "add")
    .addEdge("add", "double")
    .addEdge("double", "final")
    .addEdge("final", END)
    .compile({ checkpointer: new MemoryCheckpointer() });

  // 第一次调用
  const result1 = await graph.invoke({ value: 10, steps: [], status: "running" },
    { configurable: { thread_id: "test-after-1" } });

  console.log("首次调用:");
  console.log(`  - value: ${result1.value}`); // 应为 (10+1)*2 = 22
  console.log(`  - steps: ${result1.steps}`);
  console.log(`  - status: ${result1.status}`);
  console.assert(result1.value === 22, "double 节点应已执行，value = 22");
  console.assert(result1.steps.length === 2, "add + double 步骤");
  console.assert(result1.status === "paused", "interruptAfter 应暂停");

  // 恢复 - double 节点不应重新执行（值应保持22）
  const result2 = await graph.invoke(
    Command.resume("continue"),
    { configurable: { thread_id: "test-after-1" } }
  );

  console.log("恢复结果:");
  console.log(`  - value: ${result2.value}`);
  console.log(`  - steps: ${result2.steps}`);
  console.log(`  - status: ${result2.status}`);
  console.assert(result2.value === 22, "interruptAfter 恢复不应重新执行 double，值应保持 22");
  console.assert(result2.status === "completed", "恢复后应完成");
  console.log("✅ interruptAfter 恢复正确跳过已完成节点");
}

// ==================== 测试 3：interruptBefore 恢复执行节点 ====================

async function testInterruptBeforeResume() {
  console.log("\n=== 测试 3：interruptBefore 恢复执行节点 ===");

  const TestState = new StateSchema()
    .addField("value", z.number())
    .addField("steps", z.array(z.string()), "append")
    .addField("status", z.string());

  const checkNode = async (state: any) => ({
    steps: ["check"]
  });

  // 节点2：执行前中断
  const actionNode = async (state: any) => {
    // 恢复模式
    if (state[RESUME_VALUE_KEY] !== undefined) {
      return { value: state[RESUME_VALUE_KEY], steps: ["action_resumed"] };
    }
    return { value: 42, steps: ["action"] };
  };

  const graph = new StateGraph(TestState)
    .addNode("check", checkNode)
    .addNode("action", actionNode, { interruptBefore: true })
    .addEdge(START, "check")
    .addEdge("check", "action")
    .addEdge("action", END)
    .compile({ checkpointer: new MemoryCheckpointer() });

  // 第一次调用 - check 执行后，action 之前中断
  const result1 = await graph.invoke({ value: 0, steps: [], status: "running" },
    { configurable: { thread_id: "test-before-1" } });

  console.log("首次调用:");
  console.log(`  - steps: ${result1.steps}`);
  console.log(`  - status: ${result1.status}`);
  console.assert(result1.steps.length === 1, "只有 check 步骤");
  console.assert(result1.status === "paused", "interruptBefore 应暂停");

  // 恢复 - action 节点应执行，resumeValue 传入
  const result2 = await graph.invoke(
    Command.resume(99),
    { configurable: { thread_id: "test-before-1" } }
  );

  console.log("恢复结果:");
  console.log(`  - value: ${result2.value}`);
  console.log(`  - steps: ${result2.steps}`);
  console.log(`  - status: ${result2.status}`);
  console.assert(result2.value === 99, "interruptBefore 恢复应执行 action，resumeValue=99");
  console.assert(result2.status === "completed", "恢复后应完成");
  console.log("✅ interruptBefore 恢复正确执行节点");
}

// ==================== 测试 4：ApprovalGate 集成审批 ====================

async function testApprovalGateIntegration() {
  console.log("\n=== 测试 4：ApprovalGate 集成审批 ===");

  const TestState = new StateSchema()
    .addField("toolCalls", z.array(z.any()), "append")
    .addField("approvalStatus", z.enum(["pending", "approved", "rejected"]).nullable())
    .addField("needsApproval", z.boolean().default(false))
    .addField("pendingAction", z.any().nullable())
    .addField("results", z.array(z.any()), "append")
    .addField("currentStep", z.string())
    .addField("status", z.string());

  // 模拟 ReActAgent 调用了 bash 工具
  const reactNode = async (state: any) => ({
    toolCalls: [{ tool: "bash", params: { command: "rm -rf /tmp/test" } }],
    pendingAction: { tool: "bash", params: { command: "rm -rf /tmp/test" } },
    needsApproval: true,
    currentStep: "reactAgent",
  });

  // 审批节点：使用 __resumeValue__ 模式
  const approvalNode = async (state: any) => {
    const pendingAction = state.pendingAction;

    if (!pendingAction) {
      return { approvalStatus: "approved", needsApproval: false };
    }

    // 使用 ApprovalGate 检查
    const { approvalGate } = await import("../src/harness/hitl/approval.ts");
    const needsApprovalResult = approvalGate.needsApproval(
      pendingAction.tool, pendingAction.params
    );

    if (!needsApprovalResult) {
      return { approvalStatus: "approved", needsApproval: false };
    }

    // 恢复模式
    if (state[RESUME_VALUE_KEY] !== undefined) {
      const decision = state[RESUME_VALUE_KEY];
      if (decision === true) {
        return { approvalStatus: "approved", needsApproval: false, currentStep: "approval" };
      }
      return {
        approvalStatus: "rejected",
        needsApproval: false,
        results: [{ type: "rejected", reason: "用户拒绝审批" }],
        currentStep: "approval",
      };
    }

    // 新调用：触发中断
    const { interrupt } = await import("../src/harness/engine/command.ts");
    const approvalRequest = approvalGate.createRequest(pendingAction.tool, pendingAction.params);
    interrupt({
      type: "approval_request",
      request: approvalRequest,
      question: `是否执行 ${pendingAction.tool} 操作？`,
      details: pendingAction,
    });
    // interrupt() 抛出 InterruptSignal，此行不会执行
    return { approvalStatus: "pending", currentStep: "approval" };
  };

  const outputNode = async (state: any) => ({
    status: state.approvalStatus === "approved" ? "completed" : "rejected",
    currentStep: "output",
  });

  const graph = new StateGraph(TestState)
    .addNode("react", reactNode)
    .addNode("approval", approvalNode, { interruptAfter: true })
    .addNode("output", outputNode)
    .addEdge(START, "react")
    .addConditionalEdges("react", (state: any) => {
      if (state.needsApproval) return "approval";
      return "output";
    })
    .addConditionalEdges("approval", (state: any) => {
      if (state.approvalStatus === "approved") return "output";
      return END;
    })
    .addEdge("output", END)
    .compile({ checkpointer: new MemoryCheckpointer() });

  // 第一次调用
  const result1 = await graph.invoke(
    {
      toolCalls: [],
      approvalStatus: null,
      needsApproval: false,
      pendingAction: null,
      results: [],
      currentStep: "",
      status: "running",
    },
    { configurable: { thread_id: "test-approval-1" } }
  );

  console.log("首次调用:");
  console.log(`  - needsApproval: ${result1.needsApproval}`);
  console.log(`  - __interrupt__: ${result1.__interrupt__ ? "有" : "无"}`);
  console.assert(result1.needsApproval === true, "bash 工具应需要审批");
  console.assert(result1.__interrupt__ !== undefined, "应有中断");

  // 恢复：批准执行
  const result2 = await graph.invoke(
    Command.resume(true),
    { configurable: { thread_id: "test-approval-1" } }
  );

  console.log("批准恢复结果:");
  console.log(`  - approvalStatus: ${result2.approvalStatus}`);
  console.log(`  - status: ${result2.status}`);
  console.assert(result2.approvalStatus === "approved", "批准后应为 approved");
  console.assert(result2.status === "completed", "最终应为 completed");

  // 测试拒绝
  const result3 = await graph.invoke(
    {
      toolCalls: [],
      approvalStatus: null,
      needsApproval: false,
      pendingAction: null,
      results: [],
      currentStep: "",
      status: "running",
    },
    { configurable: { thread_id: "test-approval-2" } }
  );

  const result4 = await graph.invoke(
    Command.resume(false),
    { configurable: { thread_id: "test-approval-2" } }
  );

  console.log("拒绝恢复结果:");
  console.log(`  - approvalStatus: ${result4.approvalStatus}`);
  console.assert(result4.approvalStatus === "rejected", "拒绝后应为 rejected");
  console.log("✅ ApprovalGate 集成审批正确");
}

// ==================== 测试 5：原有简单流程仍正常 ====================

async function testOriginalSimpleFlowStillWorks() {
  console.log("\n=== 测试 5：原有简单流程仍正常 ===");

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
  console.log("✅ 原有简单流程仍正常");
}

// ==================== 运行所有测试 ====================

async function runAllTests() {
  console.log("运行 Interrupt Resume 传值机制测试...\n");

  try {
    await testOriginalSimpleFlowStillWorks();
    await testResumeValuePassing();
    await testInterruptAfterSkipNode();
    await testInterruptBeforeResume();
    await testApprovalGateIntegration();

    console.log("\n✅ 所有 Interrupt Resume 测试通过！");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

runAllTests();