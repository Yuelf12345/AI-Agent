/**
 * KnowledgeSearchSkill — 知识检索技能
 *
 * 对应 PRD §3.3.2 中的 knowledge_search
 *
 * 触发场景：
 *   "什么是..."、"解释..."、"搜索"、"查找"、"RAG"
 *
 * 关联工具：
 *   read_file, bash（用于调用 RAG Pipeline）
 *
 * 行为规则：
 *   1. 搜索结果少于 3 条时，建议扩大搜索范围
 *   2. 自动注入 RAG 上下文到 Agent Prompt
 */

import { BaseSkill, type SkillConfig } from "../baseSkill.ts";
import type { SkillContext, SkillRule } from "../../../types/index.ts";

/**
 * 知识检索技能
 */
export class KnowledgeSearchSkill extends BaseSkill {
  constructor() {
    const config: SkillConfig = {
      name: "knowledge_search",
      description: "知识检索技能 — 语义搜索知识库和笔记",
      domain: "knowledge",
      triggers: [
        {
          intent: ["search_knowledge", "explain", "define", "rag_query"],
          keywords: [
            "什么是",
            "解释",
            "搜索",
            "查找",
            "检索",
            "知识库",
            "search",
            "explain",
            "RAG",
            "含义",
            "定义",
          ],
        },
      ],
      rules: KnowledgeSearchSkill.buildRules(),
      tools: ["read_file", "bash"],
      priority: 8,
    };

    super(config);
  }

  /**
   * 构建行为规则
   */
  private static buildRules(): SkillRule[] {
    return [
      {
        name: "expand_search_scope",
        condition: (ctx: SkillContext) => {
          // 如果之前的搜索结果少于 3 条，标记需要扩大搜索
          const resultCount = (ctx["resultCount"] as number) ?? 0;
          return resultCount > 0 && resultCount < 3;
        },
        action: async (ctx: SkillContext) => {
          ctx["expandSearch"] = true;
          ctx["searchHint"] = "搜索结果较少，建议扩大检索范围或尝试不同关键词";
          console.log("[SearchSkill] 搜索结果不足，建议扩大范围");
        },
        priority: 10,
      },
      {
        name: "inject_rag_context",
        condition: (ctx: SkillContext) => {
          // 如果 context 中有 RAG 检索结果，自动注入
          return Array.isArray(ctx["ragResults"]) && (ctx["ragResults"] as unknown[]).length > 0;
        },
        action: async (ctx: SkillContext) => {
          ctx["ragContextInjected"] = true;
          console.log("[SearchSkill] 已注入 RAG 上下文");
        },
        priority: 5,
      },
    ];
  }

  /**
   * 知识检索的专属 System Prompt
   */
  getSystemPrompt(): string {
    return `你是知识检索专家，遵循以下行为准则：

## 核心能力
- **语义搜索**：基于向量相似度检索知识库中的相关内容
- **关键词搜索**：基于 BM25 算法进行全文检索
- **混合检索**：结合语义和关键词，取最优结果

## 行为规范
1. 优先使用 RAG Pipeline 进行检索增强生成
2. 搜索结果按相关度排序，标注来源和相关度分数
3. 如果找不到相关内容，明确告知用户并建议其他搜索词
4. 回答必须基于检索到的文档，不要编造内容

## 回答格式
\`\`\`
📚 检索结果：
[1] {来源} (相关度: {score})
    {摘要}

[2] {来源} (相关度: {score})
    {摘要}

💡 综合回答：
{基于检索结果的综合回答}
\`\`\`

## 注意事项
- 搜索结果少于 3 条时，提醒用户可能需要换关键词
- 引用文档时标注来源
- 不要回答知识库中没有的信息（除非用户明确要求）`;
  }

  protected async onActivate(): Promise<void> {
    console.log("[SearchSkill] 知识检索技能已就绪");
  }
}
