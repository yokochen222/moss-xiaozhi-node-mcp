/**
 * 日志工具模块
 * 提供统一的日志接口，支持不同级别的日志输出
 */

import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel;

  constructor() {
    // 从环境变量读取日志级别
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    this.level = envLevel
      ? (LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.INFO)
      : LogLevel.INFO;
  }

  private formatMessage(level: string, msg: string, error?: Error): string {
    const timestamp = new Date().toISOString();
    const errorMsg = error ? ` - ${error.message}` : '';
    return `[${level}] ${timestamp} - ${msg}${errorMsg}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  debug(msg: string): void {
    if (this.shouldLog(LogLevel.DEBUG) || process.env.DEBUG) {
      console.log(chalk.gray(this.formatMessage('DEBUG', msg)));
    }
  }

  info(msg: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(chalk.green(this.formatMessage('INFO', msg)));
    }
  }

  warning(msg: string): void {
    if (this.shouldLog(LogLevel.WARNING)) {
      console.log(chalk.yellow(this.formatMessage('WARN', msg)));
    }
  }

  error(msg: string, error?: Error | unknown): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const err = error instanceof Error ? error : undefined;
      console.log(chalk.red(this.formatMessage('ERROR', msg, err)));
      if (err && process.env.DEBUG) {
        console.error(err.stack);
      }
    }
  }
}

export const logger = new Logger();
