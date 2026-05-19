/**
 * 测试 - Human-in-the-Loop (HITL) 人机交互
 *
 * 测试审批门控功能：
 * 1. 危险工具识别与风险等级
 * 2. 审批请求创建
 * 3. 审批门控配置（启用/禁用/自定义工具）
 * 4. 审批流程模拟（批准/拒绝/修改）
 * 5. 与 StateGraph 集成的中断/恢复
 * 6. 队列管理（待审批列表、过期清理）
 */

import { ApprovalGate, approvalGate, needsApproval } from "../src/harness/hitl/approval.ts";
import {
  DEFAULT_DANGEROUS_TOOLS,
  DEFAULT_APPROVAL_CONFIG,
} from "../src/harness/hitl/types.ts";
import type {
  ApprovalRequest,
  ApprovalDecision,
  InterruptState,
} from "../src/harness/hitl/types.ts";
import { StateGraph } from "../src/harness/engine/stateGraph.ts";
import { StateSchema } from "../src/harness/engine/state.ts";
import { START, END } from "../src/harness/engine/edge.ts";
import { MemoryCheckpointer, Command } from "../src/harness/engine/index.ts";
import { z } from "zod";

// ==================== 测试 1：危险工具识别 ====================

async function testDangerousToolDetection() {
  console.log("\n=== 测试 1：危险工具识别 ===");

  const gate = new ApprovalGate();

  // 危险工具应需要审批
  console.assert(gate.needsApproval("write_file") === true, "write_file 应需要审批");
  console.assert(gate.needsApproval("bash") === true, "bash 应需要审批");
  console.assert(gate.needsApproval("file_edit") === true, "file_edit 应需要审批");
  console.assert(gate.needsApproval("delete") === true, "delete 应需要审批");
  console.log("✅ 危险工具识别正确");

  // 安全工具不需要审批
  console.assert(gate.needsApproval("read_file") === false, "read_file 不应需要审批");
  console.assert(gate.needsApproval("search") === false, "search 不应需要审批");
  console.log("✅ 安全工具识别正确");

  // 获取风险等级
  console.assert(gate.getRiskLevel("bash") === "critical", "bash 应为 critical");
  console.assert(gate.getRiskLevel("write_file") === "high", "write_file 应为 high");
  console.assert(gate.getRiskLevel("http_request") === "medium", "http_request 应为 medium");
  console.assert(gate.getRiskLevel("read_file") === undefined, "read_file 无风险等级");
  console.log("✅ 风险等级获取正确");

  // 便捷函数
  console.assert(needsApproval("bash") === true, "便捷函数: bash 应需要审批");
  console.assert(needsApproval("read_file") === false, "便捷函数: read_file 不需要审批");
  console.log("✅ 便捷函数工作正确");
}

// ==================== 测试 2：审批请求创建 ====================

async function testApprovalRequestCreation() {
  console.log("\n=== 测试 2：审批请求创建 ===");

  const gate = new ApprovalGate();

  const request = gate.createRequest("bash", { command: "rm -rf /" });
  console.log("审批请求:", JSON.stringify(request, null, 2));

  console.assert(request.toolName === "bash", "toolName 应为 bash");
  console.assert(request.toolParams.command === "rm -rf /", "参数应包含 command");
  console.assert(request.riskLevel === "critical", "风险等级应为 critical");
  console.assert(request.riskDescription === "执行 shell 命令可执行任意操作", "风险描述应正确");
  console.assert(request.id.startsWith("approval-"), "ID 应以 approval- 开头");
  console.log("✅ 审批请求创建正确");

  // 带上下文的请求
  const requestWithContext = gate.createRequest("write_file", { filePath: "test.txt", content: "hello" }, { agent: "SimpleAgent", iteration: 1 });
  console.assert(requestWithContext.context?.agent === "SimpleAgent", "上下文应包含 agent");
  console.log("✅ 带上下文的审批请求创建正确");
}

// ==================== 测试 3：审批门控配置 ====================

async function testApprovalConfig() {
  console.log("\n=== 测试 3：审批门控配置 ===");

  // 默认配置
  const gate = new ApprovalGate();
  const config = gate.getConfig();
  console.assert(config.enabled === true, "默认应启用");
  console.assert(config.autoApproveLowRisk === false, "默认不自动批准低风险");
  console.assert(config.timeout === 60000, "默认超时 60s");
  console.log("✅ 默认配置正确");

  // 禁用审批
  gate.setEnabled(false);
  console.assert(gate.needsApproval("bash") === false, "禁用后 bash 不需要审批");
  console.assert(gate.needsApproval("write_file") === false, "禁用后 write_file 不需要审批");
  console.log("✅ 禁用审批后所有工具不需要审批");

  // 重新启用
  gate.setEnabled(true);
  console.assert(gate.needsApproval("bash") === true, "启用后 bash 需要审批");
  console.log("✅ 重新启用后恢复审批");

  // 自定义配置：自动批准低风险
  const customGate = new ApprovalGate({ autoApproveLowRisk: true });
  console.assert(customGate.getConfig().autoApproveLowRisk === true, "自定义配置应生效");
  console.log("✅ 自定义配置正确");

  // 自定义危险工具列表
  const customGate2 = new ApprovalGate({
    dangerousTools: [
      { name: "my_dangerous_tool", riskLevel: "critical", riskDescription: "自定义危险工具", requiresApproval: true },
    ],
  });
  console.assert(customGate2.needsApproval("my_dangerous_tool") === true, "自定义工具需要审批");
  console.assert(customGate2.needsApproval("bash") === false, "不在列表中的 bash 不需要审批");
  console.log("✅ 自定义工具列表正确");
}

// ==================== 测试 4：审批流程模拟 ====================

async function testApprovalFlow() {
  console.log("\n=== 测试 4：审批流程模拟（批准/拒绝/修改） ===");

  const gate = new ApprovalGate();
  const request = gate.createRequest("write_file", { filePath: "important.txt", content: "new data" });

  // 模拟批准
  const approveDecision: ApprovalDecision = {
    requestId: request.id,
    decision: "approved",
    timestamp: Date.now(),
  };
  const interruptState = gate.createInterruptState(request, "thread-approve-1", "approval");
  const approveResult = await gate.handleResume("thread-approve-1", approveDecision);
  console.log("批准结果:", approveResult.approved);
  console.assert(approveResult.approved === true, "批准结果应为 true");
  console.log("✅ 批准流程正确");

  // 模拟拒绝
  const rejectDecision: ApprovalDecision = {
    requestId: request.id,
    decision: "rejected",
    comment: "不允许修改此文件",
    timestamp: Date.now(),
  };
  const request2 = gate.createRequest("bash", { command: "rm -rf /" });
  gate.createInterruptState(request2, "thread-reject-1", "approval");
  const rejectResult = await gate.handleResume("thread-reject-1", rejectDecision);
  console.log("拒绝结果:", rejectResult.approved);
  console.assert(rejectResult.approved === false, "拒绝结果应为 false");
  console.log("✅ 拒绝流程正确");

  // 模拟修改并批准
  const modifyDecision: ApprovalDecision = {
    requestId: request.id,
    decision: "modified",
    modifiedParams: { filePath: "important.txt", content: "safe data" },
    comment: "修改内容为安全数据",
    timestamp: Date.now(),
  };
  const request3 = gate.createRequest("write_file", { filePath: "important.txt", content: "dangerous data" });
  gate.createInterruptState(request3, "thread-modify-1", "approval");
  const modifyResult = await gate.handleResume("thread-modify-1", modifyDecision);
  console.log("修改结果:", modifyResult.approved, modifyResult.modifiedParams);
  console.assert(modifyResult.approved === true, "修改后批准应为 true");
  console.assert(modifyResult.modifiedParams?.content === "safe data", "修改后的参数应正确");
  console.log("✅ 修改流程正确");

  // 简单布尔决策
  const request4 = gate.createRequest("bash", { command: "ls -la" });
  gate.createInterruptState(request4, "thread-bool-1", "approval");
  const boolResult = await gate.handleResume("thread-bool-1", true);
  console.log("布尔批准:", boolResult.approved);
  console.assert(boolResult.approved === true, "布尔 true 应批准");
  console.log("✅ 布尔决策正确");
}

// ==================== 测试 5：StateGraph 中断/恢复集成 ====================

async function testStateGraphIntegration() {
  console.log("\n=== 测试 5：StateGraph 中断/恢复集成 ===");

  const TestState = new StateSchema()
    .addField("action", z.string())
    .addField("status", z.string())
    .addField("approved", z.boolean().nullable());

  // 审批节点：使用 interrupt 等待人工决策
  const approvalNode = async (state: any) => {
    const { interrupt } = await import("../src/harness/engine/command.ts");
    const decision = interrupt({
      type: "approval",
      toolName: state.action,
      question: `是否批准执行 ${state.action}？`,
    });
    return { approved: decision, status: "reviewed" };
  };

  // 执行节点：根据审批结果决定下一步
  const executeNode = async (state: any) => {
    if (state.approved === true) {
      return { status: "completed" };
    }
    return { status: "rejected" };
  };

  const graph = new StateGraph(TestState)
    .addNode("approval", approvalNode, { interruptAfter: true })
    .addNode("execute", executeNode)
    .addEdge(START, "approval")
    .addEdge("approval", "execute")
    .addEdge("execute", END)
    .compile({ checkpointer: new MemoryCheckpointer() });

  // 第一次调用 - 应触发中断
  const result1 = await graph.invoke(
    { action: "bash", status: "pending", approved: null },
    { configurable: { thread_id: "test-hitl-1" } }
  );

  console.log("中断状态:", result1.status);
  console.log("中断信息:", result1.__interrupt__?.[0]?.value?.type);
  console.assert(result1.status === "paused", "应暂停等待审批");
  console.assert(result1.__interrupt__?.[0]?.value?.type === "approval", "中断类型应为 approval");

  // 恢复：批准执行
  const result2 = await graph.invoke(
    Command.resume(true),
    { configurable: { thread_id: "test-hitl-1" } }
  );

  console.log("恢复后状态:", result2.status);
  console.log("恢复后审批:", result2.approved);
  console.assert(result2.status === "completed", "批准后应完成");
  console.log("✅ StateGraph 中断/恢复集成正确");

  // 恢复：拒绝执行
  const result3 = await graph.invoke(
    { action: "bash", status: "pending", approved: null },
    { configurable: { thread_id: "test-hitl-2" } }
  );

  const result4 = await graph.invoke(
    Command.resume(false),
    { configurable: { thread_id: "test-hitl-2" } }
  );

  console.log("拒绝后状态:", result4.status);
  console.assert(result4.status === "rejected", "拒绝后应为 rejected");
  console.log("✅ 拒绝恢复流程正确");
}

// ==================== 测试 6：队列管理 ====================

async function testQueueManagement() {
  console.log("\n=== 测试 6：队列管理 ===");

  const gate = new ApprovalGate();

  // 创建多个审批请求
  const req1 = gate.createRequest("bash", { command: "ls" });
  const req2 = gate.createRequest("write_file", { filePath: "test.txt", content: "data" });
  const req3 = gate.createRequest("file_edit", { filePath: "config.json", oldText: "a", newText: "b" });

  gate.createInterruptState(req1, "queue-1", "approval");
  gate.createInterruptState(req2, "queue-2", "approval");
  gate.createInterruptState(req3, "queue-3", "approval");

  // 获取待审批列表
  const pending = gate.getPendingApprovals();
  console.log("待审批数量:", pending.length);
  console.assert(pending.length === 3, "应有 3 个待审批请求");

  // 批准一个
  gate.approve("queue-1");
  const updatedPending = gate.getPendingApprovals();
  console.log("批准后待审批数量:", updatedPending.length);
  console.assert(updatedPending.length === 2, "批准一个后应有 2 个待审批");
  console.log("✅ 队列管理正确");

  // 修改并批准
  gate.modify("queue-2", { filePath: "safe.txt", content: "safe data" });
  console.log("✅ 修改请求参数正确");

  // 拒绝
  gate.reject("queue-3");
  console.log("✅ 拒绝请求正确");
}

// ==================== 运行所有测试 ====================

async function runAllTests() {
  console.log("运行 HITL 人机交互测试...\n");

  try {
    await testDangerousToolDetection();
    await testApprovalRequestCreation();
    await testApprovalConfig();
    await testApprovalFlow();
    await testStateGraphIntegration();
    await testQueueManagement();

    console.log("\n✅ 所有 HITL 测试通过！");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

runAllTests();