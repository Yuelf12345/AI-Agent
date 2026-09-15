/**
 * 终端日志工具：ANSI 颜色 + 图标 + 格式化输出
 *
 * 用法示例：
 *   log.info("开始处理");
 *   log.success("命令执行完成");
 *   log.error("出错了");
 *   log.tool("$ ls -la");
 *   log.banner("s01: Agent Loop");
 *   rl.question(log.prompt("s01 >>"));
 */

// ---------- ANSI 转义码 ----------
export const c = {
  reset: "\x1b[0m",
  // 样式
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  // 前景色（基本色 30-37 / 亮色 90-97）
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  // 背景色
  bgBlue: "\x1b[44m",
  bgCyan: "\x1b[46m",
  bgGray: "\x1b[100m",
} as const;

/** 用指定颜色包裹文本（自动重置） */
export const color = (code: string, text: string | unknown) =>
  `${code}${String(text)}${c.reset}`;

const timestamp = () =>
  new Date().toLocaleTimeString("zh-CN", { hour12: false });

/** 估算字符串在终端的显示宽度：CJK 字符 / emoji 按 2 算，其余按 1 算 */
const displayWidth = (s: string) =>
  [...s].reduce((w, ch) => w + (ch.codePointAt(0)! > 0x2e7f ? 2 : 1), 0);

// ---------- 日志主题（图标 + 颜色 + 标签） ----------
type Level = "info" | "success" | "warn" | "error" | "debug" | "tool" | "user" | "agent" | "tip";

const THEMES: Record<Level, { icon: string; color: string; label: string }> = {
  info:    { icon: "ℹ️",  color: c.blue,    label: "INFO" },
  success: { icon: "✅", color: c.green,   label: "OK" },
  warn:    { icon: "⚠️",  color: c.yellow,  label: "WARN" },
  error:   { icon: "❌", color: c.red,     label: "ERROR" },
  debug:   { icon: "🐛", color: c.magenta, label: "DEBUG" },
  tool:    { icon: "🔧", color: c.cyan,    label: "TOOL" },
  user:    { icon: "👤", color: c.white,   label: "USER" },
  agent:   { icon: "🤖", color: c.brightCyan, label: "AGENT" },
  tip:     { icon: "💡", color: c.brightYellow, label: "TIP" },
};

// ---------- 核心输出 ----------
const write = (level: Level, msg: string, messageColor?: string) => {
  const time = color(c.gray, `[${timestamp()}]`);
  const { icon, color: themeColor, label } = THEMES[level];
  const tag = color(themeColor + c.bold, `${icon} ${label}`.padEnd(12));
  const body = messageColor ? color(messageColor, msg) : msg;
  console.log(`${time} ${tag} ${body}`);
};

// ---------- 公开 API ----------
export const log = {
  info: (msg: string) => write("info", msg),
  success: (msg: string) => write("success", msg),
  warn: (msg: string) => write("warn", msg),
  error: (msg: string) => write("error", msg, c.red),
  debug: (msg: string) => write("debug", color(c.gray, msg)),
  tool: (msg: string) => write("tool", color(c.cyan, msg)),
  agent: (msg: string) => write("agent", msg),
  user: (msg: string) => write("user", msg),
  tip: (msg: string) => write("tip", msg),

  /** 命令输出：灰色竖线缩进展示（最多 20 行，避免刷屏） */
  output: (text: string, maxLines = 20) => {
    const lines = text.split("\n");
    for (const line of lines.slice(0, maxLines)) {
      console.log(color(c.gray, `  │ ${line}`));
    }
    if (lines.length > maxLines) {
      console.log(color(c.gray, `  │ ... 还有 ${lines.length - maxLines} 行`));
    }
  },

  /** 水平分隔线 */
  divider: (char = "─", len = 60) => console.log(color(c.gray, char.repeat(len))),

  /** 键值对输出 */
  kv: (key: string, value: string | unknown) =>
    console.log(`  ${color(c.bold, key)}: ${color(c.cyan, String(value))}`),

  /** 彩色提示符（作为输入前缀，不换行） */
  prompt: (text: string) => `${color(c.brightCyan + c.bold, `❯ ${text}`)} `,

  /** 启动横幅（带边框的盒子） */
  banner: (title: string) => {
    const text = `🚀 ${title}`;
    const dw = displayWidth(text);
    const width = dw + 4; // 左右各留 2 空格
    console.log();
    console.log(color(c.cyan, `╔${"═".repeat(width)}╗`));
    console.log(color(c.cyan, `║${" ".repeat(width)}║`));
    console.log(color(c.cyan, `║  ${color(c.bold + c.brightCyan, text)}${" ".repeat(width - dw - 2)}║`));
    console.log(color(c.cyan, `║${" ".repeat(width)}║`));
    console.log(color(c.cyan, `╚${"═".repeat(width)}╝`));
  },

  /** 带边框的消息盒子（适合错误提示等） */
  box: (lines: string[], colorCode = c.red) => {
    const width = Math.max(...lines.map((l) => displayWidth(l))) + 4;
    console.log(color(colorCode, `┌${"─".repeat(width)}┐`));
    for (const line of lines) {
      const padding = " ".repeat(width - displayWidth(line) - 2);
      console.log(color(colorCode, `│${" ".repeat(2)}${line}${padding}│`));
    }
    console.log(color(colorCode, `└${"─".repeat(width)}┘`));
  },
};
