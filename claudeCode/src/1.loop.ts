import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, ContentBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import "dotenv/config";
import { exec } from "child_process";
import { promisify } from "util";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { log } from "./utils/logger";

const execAsync = promisify(exec);

const client = new Anthropic({
  apiKey: process.env.LOCAL_API_KEY,
  baseURL: process.env.LOCAL_BASE_URL || undefined,
});
const MODEL = process.env.LOCAL_MODEL!;

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`

const TOOLS: Tool[] = [
    {
      name: "run_bash",
      description: "Run bash command. Be very careful with the command you run. Do not delete files or shutdown the system.",
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to run",
          },
        },
        required: ["command"],
      },
    },
  ]
// 1. 删除类：只要出现 rm / find -delete / mkfs 等删除意图就拦截（不匹配字面量，而是匹配命令本身）
const destructive = [
    /\brm\b/,                      // 任意形式的 rm（rm、rm -rf、rm --force...）
    /\bfind\b[^|;&]*-delete\b/,    // find xxx -delete
    /\bmkfs\b/,                    // 格式化文件系统
    /\bdd\b[^|;&]*of=\/dev\//,     // dd 写入设备
    /(^|[;&|])\s*\w+\s*>\s*\/dev\/sd[a-z]/, // 直接写设备
]
// 2. 提权 / 系统控制类：仍用关键字，但容忍任意空白（\s* + \s）
const systemControl = [
    /\bsudo\b/,
    /\bsu\s+-?\s*\broot\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bhalt\b/,
    /\bpkill\b/, /\bkillall\b/,    // 批量杀进程
    /\bchmod\b[^|;&]*\s777\b/,     // 危险权限
    /\bcurl\b[^|;&]*\|\s*(ba)?sh/, // 下载并执行脚本
]
const runBash = async (command: string) => {
    if (destructive.some(re => re.test(command)))
        return "Error: Blocked destructive command (rm/deletion is not allowed)"
    if (systemControl.some(re => re.test(command)))
        return "Error: Dangerous command blocked"
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),      // 对应 cwd=os.getcwd()
            timeout: 120_000,        // 对应 timeout=120（单位是毫秒）
            encoding: "utf8",        // 对应 text=True
            maxBuffer: 10 * 1024 * 1024,
        });
        const out = (stdout + stderr).trim();
        return out.slice(0, 50000) || "(no output)";
    } catch (error) {
        return "Error: " + error
    }
}

export const agentLoop = async (messages: MessageParam[]) => {
    while (true){
        const response = await client.messages.create({
            system: SYSTEM,
            model: MODEL,
            messages: messages,
            tools: TOOLS,
            max_tokens: 1024,
        });
        messages.push({"role": "assistant", "content": response.content})

        if(response.stop_reason !== "tool_use") return

        const results: ContentBlockParam[] = []
        for(const block of response.content){
            if(block.type === "tool_use"){
               const input = block.input as { command?: string };
               log.tool(`$ ${input.command}`);
               const output = await runBash(input.command ?? "")
               if (output.startsWith("Error:")) {
                   log.error(output);
                   log.output(output);
               } else {
                   log.success("命令执行完成");
                   log.output(output);
               }
               log.debug(JSON.stringify(block))
               results.push({
                   type: "tool_result",
                   tool_use_id: block.id,
                   content: output
               }) 
            }
        }
        messages.push({"role": "user", "content": results})
    }
}

export const main = async () => {
    log.banner("s01: Agent Loop");
    log.tip("Enter a question, press Enter to send. Type q to quit.");
    log.divider();

    const rl = readline.createInterface({ input: stdin, output: stdout });
    const history: MessageParam[] = [];

    while (true) {
        let query: string;
        try {
            query = await rl.question(log.prompt("s01 >>"));
        } catch {
            break; // Ctrl+D / EOF
        }
        if (["q", "exit", ""].includes(query.trim().toLowerCase())) break;

        history.push({ role: "user", content: query });
        await agentLoop(history);

        // 打印模型最终的文本回复
        const last = history[history.length - 1];
        if (Array.isArray(last.content)) {
            for (const block of last.content) {
                if (block.type === "text") {
                    log.divider("━");
                    log.agent(block.text);
                    log.divider("━");
                }
            }
        }
        console.log();
    }
    rl.close();
    process.exit(0);
};