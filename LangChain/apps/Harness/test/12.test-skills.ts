/**
 * Test 12 — Skills 系统测试
 *
 * 测试内容：
 *   1. 技能注册与生命周期
 *   2. 关键词匹配与意图匹配
 *   3. 规则引擎（前置规则执行）
 *   4. 技能激活与 Prompt 注入
 *   5. 多技能冲突解决（优先级排序）
 *   6. SkillRegistry 全局单例
 *
 * 运行方式：
 *   cd apps/Harness && npx tsx --env-file=../../.env test/12.test-skills.ts
 */

import {
  BaseSkill,
  SkillRegistry,
  NoteManagementSkill,
  KnowledgeSearchSkill,
  TaskExtractionSkill,
  initializeSkills,
  skillRegistry,
} from "../src/harness/skills/index.ts";
import type { SkillContext } from "../src/types/index.ts";

// ==================== 辅助工具 ====================

function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    console.error(`  ❌ ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ==================== 测试 1: 技能注册与生命周期 ====================

async function testLifecycle() {
  section("测试 1: 技能注册与生命周期");

  const registry = new SkillRegistry();
  const noteSkill = new NoteManagementSkill();

  // 初始状态
  assert(noteSkill.state === "REGISTERED", "初始状态为 REGISTERED");
  assert(noteSkill.usageCount === 0, "初始使用次数为 0");

  // 注册
  registry.register(noteSkill);
  assert(registry.size === 1, "注册后 size = 1");
  assert(registry.get("note_management") === noteSkill, "可以通过 name 获取");

  // 激活
  await noteSkill.activate();
  assert(noteSkill.state === "ACTIVE", "激活后状态为 ACTIVE");
  assert(noteSkill.activatedAt !== null, "激活时间已记录");

  // 暂停
  await noteSkill.suspend("test");
  assert(noteSkill.state === "SUSPENDED", "暂停后状态为 SUSPENDED");

  // 重新激活
  await noteSkill.activate();
  assert(noteSkill.state === "ACTIVE", "重新激活后状态为 ACTIVE");

  // 废弃
  await noteSkill.deprecate();
  assert(noteSkill.state === "DEPRECATED", "废弃后状态为 DEPRECATED");

  // 废弃后无法激活
  try {
    await noteSkill.activate();
    assert(false, "废弃后激活应抛出异常");
  } catch (e: any) {
    assert(e.message.includes("已废弃"), "废弃后激活抛出正确异常");
  }

  console.log("  🎉 生命周期测试全部通过");
}

// ==================== 测试 2: 关键词匹配 ====================

async function testKeywordMatching() {
  section("测试 2: 关键词匹配");

  const noteSkill = new NoteManagementSkill();
  const searchSkill = new KnowledgeSearchSkill();
  const taskSkill = new TaskExtractionSkill();

  // 笔记技能匹配
  const noteMatch1 = noteSkill.match("帮我记一下今天的会议内容");
  assert(noteMatch1.matched === true, "'记一下' 触发笔记技能");
  assert(noteMatch1.matchedKeywords.includes("记一下"), "匹配关键词包含 '记一下'");

  const noteMatch2 = noteSkill.match("今天天气不错");
  assert(noteMatch2.matched === false, "'天气不错' 不触发笔记技能");

  const noteMatch3 = noteSkill.match("create a new note about the project");
  assert(noteMatch3.matched === true, "'note' 触发笔记技能（英文）");

  // 知识检索匹配
  const searchMatch1 = searchSkill.match("什么是 RAG？");
  assert(searchMatch1.matched === true, "'什么是' 触发知识检索");

  const searchMatch2 = searchSkill.match("解释一下 embedding 的含义");
  assert(searchMatch2.matched === true, "'解释' + '含义' 触发知识检索");

  // 待办提取匹配
  const taskMatch1 = taskSkill.match("从会议记录中提取待办事项");
  assert(taskMatch1.matched === true, "'待办' + '提取' 触发待办技能");

  const taskMatch2 = taskSkill.match("今天要做的事情有哪些");
  assert(taskMatch2.matched === true, "'要做' 触发待办技能");

  // 暂停后不匹配
  await noteSkill.activate();
  await noteSkill.suspend("test");
  const suspendedMatch = noteSkill.match("帮我记一下笔记");
  assert(suspendedMatch.matched === false, "暂停后不匹配");

  console.log("  🎉 关键词匹配测试全部通过");
}

// ==================== 测试 3: 意图匹配 ====================

async function testIntentMatching() {
  section("测试 3: 意图匹配");

  const noteSkill = new NoteManagementSkill();

  // 有意图时高置信度匹配
  const intentMatch = noteSkill.match("随便说点什么", "create_note");
  assert(intentMatch.matched === true, "意图 'create_note' 触发匹配");
  assert(intentMatch.confidence >= 0.9, "意图匹配置信度 >= 0.9");

  // 无意图时不匹配
  const noIntentMatch = noteSkill.match("随便说点什么");
  assert(noIntentMatch.matched === false, "无关键词无意图时不匹配");

  console.log("  🎉 意图匹配测试全部通过");
}

// ==================== 测试 4: 规则引擎 ====================

async function testRuleEngine() {
  section("测试 4: 规则引擎");

  const noteSkill = new NoteManagementSkill();
  await noteSkill.activate();

  // 测试 auto_tag_meeting 规则
  const context1: SkillContext = {
    message: {
      id: "msg-1",
      role: "user",
      content: "帮我记录今天的会议内容",
      timestamp: new Date(),
    },
  };

  const result1 = await noteSkill.executePreRules(context1);
  assert(result1.applied.includes("auto_tag_meeting"), "会议关键词触发 auto_tag 规则");
  assert(
    (context1["suggestedTags"] as string[])?.includes("meeting"),
    "context 中注入了 meeting 标签",
  );
  assert(result1.applied.includes("auto_timestamp"), "auto_timestamp 规则始终触发");

  // 测试 auto_tag_important 规则
  const context2: SkillContext = {
    message: {
      id: "msg-2",
      role: "user",
      content: "这是一个紧急的笔记",
      timestamp: new Date(),
    },
  };

  const result2 = await noteSkill.executePreRules(context2);
  assert(result2.applied.includes("auto_tag_important"), "紧急关键词触发 important 标签");

  // 测试任务技能的紧急检测
  const taskSkill = new TaskExtractionSkill();
  await taskSkill.activate();

  const taskContext: SkillContext = {
    message: {
      id: "msg-3",
      role: "user",
      content: "紧急：明天之前完成报告",
      timestamp: new Date(),
    },
  };

  const taskResult = await taskSkill.executePreRules(taskContext);
  assert(taskResult.applied.includes("detect_urgency"), "紧急关键词触发 urgency 检测");
  assert(taskResult.applied.includes("detect_deadline"), "'明天' 触发 deadline 检测");
  assert(taskContext["defaultPriority"] === "high", "默认优先级设为 high");
  assert(taskContext["hasDeadline"] === true, "hasDeadline 标记为 true");

  console.log("  🎉 规则引擎测试全部通过");
}

// ==================== 测试 5: SkillRegistry 匹配排序 ====================

async function testRegistryMatching() {
  section("测试 5: SkillRegistry 匹配与排序");

  const registry = new SkillRegistry();
  registry.registerAll([
    new NoteManagementSkill(),
    new KnowledgeSearchSkill(),
    new TaskExtractionSkill(),
  ]);

  assert(registry.size === 3, "注册了 3 个技能");

  // 测试笔记匹配
  const noteMatches = registry.matchSkills("帮我记一下会议笔记");
  assert(noteMatches.length > 0, "笔记输入匹配到技能");
  assert(
    noteMatches[0].skill.name === "note_management",
    "最佳匹配是 note_management",
  );

  // 测试多技能匹配
  const multiMatches = registry.matchSkills("搜索笔记中的待办事项");
  assert(multiMatches.length >= 2, "'搜索笔记中的待办' 匹配到多个技能");
  console.log(
    `  📊 多技能匹配: ${multiMatches.map((m) => m.skill.name).join(", ")}`,
  );

  // 测试 bestMatch
  const best = registry.matchBest("什么是 embedding？");
  assert(best !== null, "知识查询有最佳匹配");
  assert(
    best!.skill.name === "knowledge_search",
    "知识查询最佳匹配是 knowledge_search",
  );

  // 无匹配
  const noMatch = registry.matchSkills("今天天气真不错");
  assert(noMatch.length === 0, "无关输入不匹配任何技能");

  console.log("  🎉 Registry 匹配排序测试全部通过");
}

// ==================== 测试 6: 激活最佳技能 ====================

async function testActivateBest() {
  section("测试 6: 激活最佳技能（端到端）");

  const registry = new SkillRegistry();
  registry.registerAll([
    new NoteManagementSkill(),
    new KnowledgeSearchSkill(),
    new TaskExtractionSkill(),
  ]);

  // 激活笔记技能
  const result1 = await registry.activateBest("帮我记一下今天的会议内容", undefined, undefined);
  assert(result1 !== null, "激活成功");
  assert(result1!.activatedSkills.length > 0, "有激活的技能");
  assert(result1!.activatedSkills[0].skillName === "note_management", "激活的是 note_management");
  assert(result1!.combinedPrompt.length > 0, "组合 Prompt 非空");
  assert(result1!.combinedTools.includes("read_file"), "工具列表包含 read_file");
  assert(result1!.combinedTools.includes("write_file"), "工具列表包含 write_file");

  console.log(`  📝 激活技能: ${result1!.activatedSkills.map((s) => s.skillName).join(", ")}`);
  console.log(`  🔧 可用工具: ${result1!.combinedTools.join(", ")}`);
  console.log(`  📋 应用的规则: ${result1!.activatedSkills[0].rulesApplied.join(", ")}`);

  // 激活知识检索
  const result2 = await registry.activateBest("什么是 RAG 检索增强生成？");
  assert(result2 !== null, "知识查询激活成功");
  assert(
    result2!.activatedSkills.some((s) => s.skillName === "knowledge_search"),
    "激活了 knowledge_search",
  );

  // 激活待办提取
  const result3 = await registry.activateBest("从会议记录中提取待办事项");
  assert(result3 !== null, "待办提取激活成功");
  assert(
    result3!.activatedSkills.some((s) => s.skillName === "task_extraction"),
    "激活了 task_extraction",
  );

  // 无匹配
  const result4 = await registry.activateBest("今天天气不错");
  assert(result4 === null, "无关输入返回 null");

  console.log("  🎉 激活最佳技能测试全部通过");
}

// ==================== 测试 7: 全局单例与初始化 ====================

async function testGlobalInit() {
  section("测试 7: 全局单例与 initializeSkills");

  // 先清空
  await skillRegistry.clear();
  assert(skillRegistry.size === 0, "清空后 size = 0");

  // 使用便捷初始化
  const registry = initializeSkills();
  assert(registry.size === 3, "初始化后注册了 3 个内置技能");
  assert(registry.get("note_management") !== undefined, "note_management 已注册");
  assert(registry.get("knowledge_search") !== undefined, "knowledge_search 已注册");
  assert(registry.get("task_extraction") !== undefined, "task_extraction 已注册");

  // 统计
  const stats = registry.getStats();
  assert(stats.total === 3, "total = 3");
  assert(stats.registered === 3, "全部处于 REGISTERED 状态");

  // 摘要
  console.log("\n" + registry.getSummary());

  // 按领域过滤
  const knowledgeSkills = registry.getByDomain("knowledge");
  assert(knowledgeSkills.length === 2, "knowledge 领域有 2 个技能");

  const productivitySkills = registry.getByDomain("productivity");
  assert(productivitySkills.length === 1, "productivity 领域有 1 个技能");

  // 导出定义
  const definitions = registry.exportDefinitions();
  assert(definitions.length === 3, "导出 3 个 SkillDefinition");
  assert(definitions[0].name !== undefined, "Definition 包含 name");
  assert(definitions[0].triggers !== undefined, "Definition 包含 triggers");

  // 清理
  await registry.clear();

  console.log("  🎉 全局初始化测试全部通过");
}

// ==================== 测试 8: System Prompt 内容验证 ====================

async function testSystemPrompts() {
  section("测试 8: System Prompt 内容验证");

  const noteSkill = new NoteManagementSkill();
  const searchSkill = new KnowledgeSearchSkill();
  const taskSkill = new TaskExtractionSkill();

  const notePrompt = noteSkill.getSystemPrompt();
  assert(notePrompt.includes("笔记管理专家"), "笔记 Prompt 包含角色定义");
  assert(notePrompt.includes("Markdown"), "笔记 Prompt 包含 Markdown 规范");

  const searchPrompt = searchSkill.getSystemPrompt();
  assert(searchPrompt.includes("知识检索专家"), "检索 Prompt 包含角色定义");
  assert(searchPrompt.includes("RAG"), "检索 Prompt 包含 RAG 概念");

  const taskPrompt = taskSkill.getSystemPrompt();
  assert(taskPrompt.includes("待办"), "待办 Prompt 包含待办概念");
  assert(taskPrompt.includes("priority"), "待办 Prompt 包含优先级");

  console.log("  🎉 System Prompt 测试全部通过");
}

// ==================== 主测试入口 ====================

async function main() {
  console.log("🧪 Skills 系统测试\n");
  console.log("测试 Skills 的注册、匹配、规则引擎、激活等核心能力");

  try {
    await testLifecycle();
    await testKeywordMatching();
    await testIntentMatching();
    await testRuleEngine();
    await testRegistryMatching();
    await testActivateBest();
    await testGlobalInit();
    await testSystemPrompts();

    section("🎉 全部测试通过！");
    console.log("  Skills 系统已验证完毕\n");
  } catch (error: any) {
    console.error("\n❌ 测试失败:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
