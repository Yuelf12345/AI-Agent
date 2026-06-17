import { OpenAI } from "@llamaindex/openai";
import * as fs from "fs";
import * as path from "path";

// ─── LLM 配置 ─────────────────────────────────────────────────────────
const configs = {
  local: {
    model: process.env.LOCAL_MODEL || "qwen2.5:7b",   // 通义千问本地模型
    apiKey: process.env.LOCAL_API_KEY,
    baseURL: process.env.LOCAL_BASE_URL,
  },
  default: {
    model: process.env.OPENAI_MODEL || "qwen-plus",   // 通义大语言本地模型
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  },
  vision: {
    model: "qwen-vl-plus",  // 通义千问视觉模型
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }
} as const;

const key = (process.env.LOCAL || "default") as keyof typeof configs;
const rawLlm = new OpenAI(configs[key]);

// ─── Token 跟踪器 ─────────────────────────────────────────────────────
const model = configs[key].model;

// ─── 日志目录 ─────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(new URL(".", import.meta.url).pathname, "../log");

/** 估算 token 数：中文字符≈2 token，英文单词≈1.3 token */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const englishText = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, " ");
  const englishWords = englishText.split(/\s+/).filter(Boolean).length;
  return Math.ceil(chineseChars * 2 + englishWords * 1.3);
}

interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  label: string;
}

class TokenTracker {
  private records: UsageRecord[] = [];
  private sessionStart = Date.now();

  /** 跟踪一次 LLM 调用 */
  track(inputTokens: number, outputTokens: number, label = "") {
    this.records.push({ inputTokens, outputTokens, label });
  }

  /** 打印并写入日志文件 */
  printUsage() {
    const totalInput = this.records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = this.records.reduce((s, r) => s + r.outputTokens, 0);
    const totalCalls = this.records.length;
    const elapsed = ((Date.now() - this.sessionStart) / 1000).toFixed(1);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    // 按 label 分组
    const byLabel = new Map<string, { calls: number; in: number; out: number }>();
    for (const r of this.records) {
      const key = r.label || "未分类";
      if (!byLabel.has(key)) byLabel.set(key, { calls: 0, in: 0, out: 0 });
      const g = byLabel.get(key)!;
      g.calls++; g.in += r.inputTokens; g.out += r.outputTokens;
    }

    // 构筑报告文本
    let costLine = "";
    if (model.includes("qwen-plus")) {
      const cost = (totalInput * 0.0008 + totalOutput * 0.002) / 1000;
      costLine = `   预估费用:    ¥${cost.toFixed(4)}`;
    }
    const detailLines = [...byLabel].map(([label, s]) =>
      `   ${label.slice(0, 40)}: ${s.calls}次, 输入${s.in.toLocaleString()}, 输出${s.out.toLocaleString()}`
    ).join("\n");

    const report = [
      "",
      "─".repeat(60),
      `📊 Token 使用统计 (${timestamp})`,
      "─".repeat(60),
      `   模型:        ${model}`,
      `   调用次数:    ${totalCalls}`,
      `   输入 Token:  ${totalInput.toLocaleString()}`,
      `   输出 Token:  ${totalOutput.toLocaleString()}`,
      `   合计 Token:  ${(totalInput + totalOutput).toLocaleString()}`,
      `   运行耗时:    ${elapsed}s`,
      costLine,
      "─".repeat(60),
      "  按类型明细:",
      detailLines,
      "─".repeat(60),
    ].filter(Boolean).join("\n");

    // 打印到控制台
    console.log(report);

    // 写入文件
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      // 当前会话日志
      const sessionFile = path.resolve(LOG_DIR, `session_${timestamp}.log`);
      fs.writeFileSync(sessionFile, [
        report,
        "",
        "  逐条明细:",
        ...this.records.map((r, i) =>
          `   [${i + 1}] 输入${r.inputTokens}t → 输出${r.outputTokens}t  ${r.label.slice(0, 50)}`
        ),
      ].join("\n"), "utf-8");

      // 累计日志（追加）
      const cumFile = path.resolve(LOG_DIR, "cumulative.log");
      fs.appendFileSync(cumFile, `\n${report}\n`, "utf-8");

      console.log(`📝 日志已写入 ${sessionFile}`);
    } catch { /* 日志写入失败不影响主流程 */ }
  }
}

export const tokenTracker = new TokenTracker();

// ─── 包装 LLM：自动跟踪 token ────────────────────────────────────────
const llm = new Proxy(rawLlm, {
  get(target, prop) {
    if (prop === "chat") {
      return async (params: any) => {
        // 估算输入 token
        const inputText = params.messages?.map((m: any) => m.content || "").join("\n") || "";
        const inputTokens = estimateTokens(inputText);

        const start = Date.now();
        const resp = await (target as any).chat(params);
        const ms = Date.now() - start;

        // 估算输出 token
        const outputText = resp?.message?.content || "";
        const outputTokens = estimateTokens(outputText);
        const label = params.messages?.[0]?.content?.slice(0, 30) || "";

        tokenTracker.track(inputTokens, outputTokens, label);

        // 每次调用后打印（可选短格式）
        console.log(`   ⚡ LLM: 输入${inputTokens}t → 输出${outputTokens}t (${ms}ms)`);

        return resp;
      };
    }
    return (target as any)[prop];
  }
});

export default llm;


