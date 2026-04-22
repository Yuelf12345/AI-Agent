import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGS_DIR = path.join(__dirname, "..", "logs");
const TEAMS_LOGS_DIR = path.join(LOGS_DIR, "teams");

let currentLogFile = getLogFilePath();

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function ensureTeamsLogsDir(): void {
  if (!fs.existsSync(TEAMS_LOGS_DIR)) {
    fs.mkdirSync(TEAMS_LOGS_DIR, { recursive: true });
  }
}

function getLogFilePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(LOGS_DIR, `agent-${timestamp}.log`);
}

function newLogFile(): void {
  currentLogFile = getLogFilePath();
}

function setLogFile(filepath: string): void {
  currentLogFile = filepath;
}

// 日志类型定义
type LogType = "start" | "stop" | "msg" | "tool" | "llm" | "error" | "status" | "loop" | "info";

// 日志图标映射
const LOG_ICONS: Record<LogType, string> = {
  start: "🚀",
  stop: "🛑",
  msg: "📨",
  tool: "🔧",
  llm: "🤖",
  error: "❌",
  status: "📊",
  loop: "🔄",
  info: "ℹ️",
};

function log(message: string, type: LogType = "info"): void {
  ensureLogsDir();
  const timestamp = new Date().toISOString();
  const icon = LOG_ICONS[type];
  const separator = "=".repeat(60);
  const logLine = `${separator}\n[${timestamp}] ${icon} ${message}\n${separator}\n\n`;
  fs.appendFileSync(currentLogFile, logLine, "utf-8");
}

// 便捷日志函数
const logStart = (msg: string) => log(msg, "start");
const logStop = (msg: string) => log(msg, "stop");
const logMsg = (msg: string) => log(msg, "msg");
const logTool = (msg: string) => log(msg, "tool");
const logLLM = (msg: string) => log(msg, "llm");
const logError = (msg: string) => log(msg, "error");
const logStatus = (msg: string) => log(msg, "status");
const logLoop = (msg: string) => log(msg, "loop");

export { 
  log, 
  newLogFile, 
  setLogFile, 
  ensureLogsDir,
  ensureTeamsLogsDir,
  LOGS_DIR,
  TEAMS_LOGS_DIR,
  logStart,
  logStop,
  logMsg,
  logTool,
  logLLM,
  logError,
  logStatus,
  logLoop
};
