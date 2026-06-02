/**
 * Test 13 — 声明式 Skill (.skill.md) 测试
 *
 * 测试内容：
 *   1. 解析 .skill.md 文件（frontmatter + body）
 *   2. DeclarativeSkill 匹配与规则执行
 *   3. SkillLoader 目录扫描
 *   4. 声明式 vs 代码式 Skill 共存
 *
 * 运行方式：
 *   cd /path/to/LangChain && node_modules/.bin/tsx --env-file=.env apps/Harness/test/13.test-declarative-skills.ts
 */

import * as path from "path";
import {
  DeclarativeSkill,
  loadSkillsFromDir,
  loadSkillFile,
  skillRegistry,
  SkillRegistry,
} from "../src/harness/skills/index.ts";

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

const BUILTIN_DIR = path.join(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../src/harness/skills/builtin",
);

// ==================== 测试 1: 解析单个 .skill.md 文件 ====================

async function testParseFile() {
  section("测试 1: 解析 .skill.md 文件");

  const skillPath = path.join(BUILTIN_DIR, "note_management.skill.md");
  const skill = await loadSkillFile(skillPath);

  assert(skill instanceof DeclarativeSkill, "返回 DeclarativeSkill 实例");
  assert(skill.name === "note_management", "name = note_management");
  assert(skill.description.includes("笔记管理"), "description 包含 '笔记管理'");
  assert(skill.domain === "knowledge", "domain = knowledge");
  assert(skill.priority === 10, "priority = 10");
  assert(skill.tools.includes("read_file"), "tools 包含 read_file");
  assert(skill.tools.includes("write_file"), "tools 包含 write_file");

  // 检查 triggers
  const match = skill.match("帮我记一下今天的会议内容");
  assert(match.matched === true, "'记一下' 触发匹配");
  assert(match.matchedKeywords.includes("记一下"), "关键词包含 '记一下'");

  // 检查 System Prompt（Markdown 正文）
  const prompt = skill.getSystemPrompt();
  assert(prompt.includes("笔记管理专家"), "Prompt 包含 '笔记管理专家'");
  assert(prompt.includes("Markdown"), "Prompt 包含 'Markdown'");
  assert(prompt.length > 100, "Prompt 长度 > 100 字符");

  // 检查 rules
  assert(skill.rules.length === 3, `rules 数量 = 3 (实际: ${skill.rules.length})`);
  assert(skill.rules[0]!.name === "auto_tag_meeting", "第一个规则是 auto_tag_meeting");

  // 检查文件路径
  assert(skill.filePath.includes("note_management.skill.md"), "filePath 包含文件名");

  console.log("  🎉 .skill.md 解析测试全部通过");
}

// ==================== 测试 2: 目录扫描加载 ====================

async function testDirectoryScan() {
  section("测试 2: 目录扫描加载");

  const skills = await loadSkillsFromDir(BUILTIN_DIR);

  assert(skills.length >= 2, `至少加载了 2 个 .skill.md 文件 (实际: ${skills.length})`);

  const names = skills.map((s) => s.name);
  assert(names.includes("note_management"), "包含 note_management");
  assert(names.includes("knowledge_search"), "包含 knowledge_search");

  console.log(`  📁 扫描到 ${skills.length} 个声明式技能: ${names.join(", ")}`);
  console.log("  🎉 目录扫描测试全部通过");
}

// ==================== 测试 3: 声明式 Skill 匹配与规则 ====================

async function testDeclarativeMatching() {
  section("测试 3: 声明式 Skill 匹配与规则");

  const registry = new SkillRegistry();
  const skills = await loadSkillsFromDir(BUILTIN_DIR);
  registry.registerAll(skills);

  // 笔记匹配
  const noteMatch = registry.matchBest("帮我记一下会议笔记");
  assert(noteMatch !== null, "笔记输入匹配到技能");
  assert(noteMatch!.skill.name === "note_management", "最佳匹配是 note_management");

  // 知识搜索匹配
  const searchMatch = registry.matchBest("什么是 RAG？");
  assert(searchMatch !== null, "知识查询匹配到技能");
  assert(searchMatch!.skill.name === "knowledge_search", "最佳匹配是 knowledge_search");

  // 激活并执行规则
  const result = await registry.activateBest("帮我记录会议内容");
  assert(result !== null, "激活成功");
  assert(
    result!.activatedSkills[0]!.skillName === "note_management",
    "激活的是 note_management",
  );
  assert(result!.combinedTools.includes("read_file"), "工具列表包含 read_file");

  // 规则执行
  const activatedSkill = result!.activatedSkills[0]!;
  assert(
    activatedSkill.rulesApplied.includes("auto_tag_meeting"),
    "auto_tag_meeting 规则被触发",
  );
  assert(
    activatedSkill.rulesApplied.includes("auto_timestamp"),
    "auto_timestamp 规则被触发",
  );

  console.log("  🎉 声明式匹配与规则测试全部通过");
}

// ==================== 测试 4: 声明式 + 代码式共存 ====================

async function testCoexistence() {
  section("测试 4: 声明式 + 代码式共存");

  await skillRegistry.clear();

  // 加载代码式技能（task_extraction 没有 .skill.md 版本）
  const { TaskExtractionSkill } = await import(
    "../src/harness/skills/builtin/taskExtraction.ts"
  );
  skillRegistry.register(new TaskExtractionSkill());

  // 加载声明式技能
  await loadAndRegisterSkills(BUILTIN_DIR, skillRegistry);

  assert(skillRegistry.size >= 3, `至少 3 个技能共存 (实际: ${skillRegistry.size})`);

  // 代码式技能正常工作
  const taskMatch = skillRegistry.matchBest("提取待办事项");
  assert(taskMatch !== null, "待办提取匹配成功");
  assert(taskMatch!.skill.name === "task_extraction", "代码式 task_extraction 正常");

  // 声明式技能正常工作
  const noteMatch = skillRegistry.matchBest("帮我记一下笔记");
  assert(noteMatch !== null, "笔记匹配成功");
  assert(noteMatch!.skill.name === "note_management", "声明式 note_management 正常");

  // 摘要
  console.log("\n" + skillRegistry.getSummary());

  // 统计
  const stats = skillRegistry.getStats();
  console.log(`  📊 统计: total=${stats.total}, active=${stats.active}, registered=${stats.registered}`);

  await skillRegistry.clear();
  console.log("  🎉 共存测试全部通过");
}

// ==================== 测试 5: 声明式 Skill 的摘要信息 ====================

async function testSummary() {
  section("测试 5: 声明式 Skill 摘要");

  const skillPath = path.join(BUILTIN_DIR, "knowledge_search.skill.md");
  const skill = await loadSkillFile(skillPath);

  const summary = skill.getSummary();
  assert(summary.includes("声明式"), "摘要标注为声明式");
  assert(summary.includes(".skill.md"), "摘要包含 .skill.md");
  assert(summary.includes(skill.filePath), "摘要包含文件路径");

  console.log(`\n  📋 摘要:\n${summary}`);
  console.log("  🎉 摘要测试全部通过");
}

// ==================== 导入辅助 ====================

import { loadAndRegisterSkills } from "../src/harness/skills/index.ts";

// ==================== 主测试入口 ====================

async function main() {
  console.log("🧪 声明式 Skill (.skill.md) 测试\n");
  console.log("测试 .skill.md 文件的解析、加载、匹配和规则执行");

  try {
    await testParseFile();
    await testDirectoryScan();
    await testDeclarativeMatching();
    await testCoexistence();
    await testSummary();

    section("🎉 全部测试通过！");
    console.log("  声明式 Skill 系统已验证完毕");
    console.log("  .skill.md 格式可正常工作\n");
  } catch (error: any) {
    console.error("\n❌ 测试失败:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
