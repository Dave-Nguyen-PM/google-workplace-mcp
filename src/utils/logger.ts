import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let loggingEnabled = false;
let logFilePath: string | null = null;

export function setLoggingEnabled(enabled: boolean) {
  loggingEnabled = enabled;
  if (enabled && !logFilePath) {
    const logDir = path.join(os.homedir(), '.google-workspace-mcp');
    fs.mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, 'debug.log');
  }
}

export function logToFile(message: string) {
  if (!loggingEnabled || !logFilePath) return;
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
}
