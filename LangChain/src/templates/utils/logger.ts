import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGS_DIR = path.join(__dirname, "..", "logs");

let currentLogFile = getLogFilePath();

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
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

function log(message: string): void {
  ensureLogsDir();
  const timestamp = new Date().toISOString();
  const separator = "=".repeat(60);
  const logLine = `${separator}\n[${timestamp}] ${message}\n${separator}\n\n`;
  fs.appendFileSync(currentLogFile, logLine, "utf-8");
}

export { log, newLogFile, setLogFile, ensureLogsDir, LOGS_DIR };
