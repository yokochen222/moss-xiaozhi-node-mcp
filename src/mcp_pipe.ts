#!/usr/bin/env node

/**
 * MCP stdio <-> WebSocket 管道程序
 * 版本: 0.3.0
 *
 * 用法（环境变量）:
 *     export MCP_ENDPOINT=<ws_endpoint>
 *     # Windows (PowerShell): $env:MCP_ENDPOINT = "<ws_endpoint>"
 *
 * 从配置启动服务器进程:
 * 运行所有配置的服务器
 *     node dist/mcp_pipe.js
 *
 * 配置发现顺序:
 *     $MCP_CONFIG, 然后 ./mcp_config.json
 */

import WebSocket from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { config } from 'dotenv';
import { logger } from './utils/logger.js';
import { loadConfig, getEnabledServers } from './utils/config.js';
import { buildServerCommand } from './utils/server.js';
import type { ServerConfig } from './types/config.js';

// 自动加载 .env 文件中的环境变量
config();

// 重连设置
const INITIAL_BACKOFF = 1; // 初始等待时间（秒）
const MAX_BACKOFF = 600; // 最大等待时间（秒）
const PROCESS_SHUTDOWN_TIMEOUT = 5000; // 进程关闭超时时间（毫秒）

/**
 * 从 WebSocket 读取数据并写入进程 stdin
 */
async function pipeWebSocketToProcess(
  websocket: WebSocket,
  process: ChildProcess,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const messageHandler = (message: WebSocket.Data) => {
      try {
        const data =
          message instanceof Buffer ? message.toString('utf-8') : String(message);
        logger.debug(`[${target}] << ${data.substring(0, 120)}...`);

        if (process.stdin && !process.stdin.destroyed) {
          // MCP 协议使用换行符分隔的 JSON-RPC 消息
          const message = data.endsWith('\n') ? data : data + '\n';
          process.stdin.write(message);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`[${target}] WebSocket 到进程管道错误`, err);
        reject(err);
      }
    };

    const closeHandler = () => {
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      websocket.off('message', messageHandler);
      websocket.off('close', closeHandler);
      websocket.off('error', errorHandler);
      resolve();
    };

    const errorHandler = (error: Error) => {
      logger.error(`[${target}] WebSocket 错误`, error);
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      websocket.off('message', messageHandler);
      websocket.off('close', closeHandler);
      websocket.off('error', errorHandler);
      reject(error);
    };

    websocket.on('message', messageHandler);
    websocket.on('close', closeHandler);
    websocket.on('error', errorHandler);
  });
}

/**
 * 从进程 stdout 读取数据并发送到 WebSocket
 * MCP 协议使用换行符分隔的 JSON-RPC 消息，需要缓冲数据并按行发送
 */
async function pipeProcessToWebSocket(
  process: ChildProcess,
  websocket: WebSocket,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.stdout) {
      reject(new Error('进程没有 stdout'));
      return;
    }

    let buffer = '';
    process.stdout.setEncoding('utf-8');

    const dataHandler = (data: string) => {
      if (websocket.readyState === WebSocket.OPEN) {
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            logger.debug(`[${target}] >> ${line.substring(0, 120)}...`);
            websocket.send(line);
          }
        }
      }
    };

    const endHandler = () => {
      if (buffer.trim() && websocket.readyState === WebSocket.OPEN) {
        logger.debug(`[${target}] >> ${buffer.substring(0, 120)}...`);
        websocket.send(buffer);
        buffer = '';
      }
      logger.info(`[${target}] 进程输出已结束`);
    };

    const errorHandler = (error: Error) => {
      logger.error(`[${target}] 进程到 WebSocket 管道错误`, error);
      process.stdout?.off('data', dataHandler);
      process.stdout?.off('end', endHandler);
      process.stdout?.off('error', errorHandler);
      process.off('exit', exitHandler);
      reject(error);
    };

    const exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      logger.info(`[${target}] 进程退出，代码: ${code}, 信号: ${signal}`);
      process.stdout?.off('data', dataHandler);
      process.stdout?.off('end', endHandler);
      process.stdout?.off('error', errorHandler);
      process.off('exit', exitHandler);
      resolve();
    };

    process.stdout.on('data', dataHandler);
    process.stdout.on('end', endHandler);
    process.stdout.on('error', errorHandler);
    process.on('exit', exitHandler);
  });
}

/**
 * 从进程 stderr 读取数据并打印到终端
 */
async function pipeProcessStderrToTerminal(
  process: ChildProcess,
  target: string
): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stderr) {
      resolve();
      return;
    }

    const childStderr = process.stderr;
    childStderr.setEncoding('utf-8');

    const dataHandler = (data: string) => {
      const globalStderr = globalThis.process.stderr;
      if (globalStderr) {
        globalStderr.write(data);
      }
    };

    const endHandler = () => {
      logger.info(`[${target}] 进程 stderr 输出已结束`);
    };

    const exitHandler = () => {
      childStderr.off('data', dataHandler);
      childStderr.off('end', endHandler);
      process.off('exit', exitHandler);
      resolve();
    };

    childStderr.on('data', dataHandler);
    childStderr.on('end', endHandler);
    process.on('exit', exitHandler);
  });
}

/**
 * 安全地终止进程
 */
async function terminateProcess(
  process: ChildProcess,
  target: string
): Promise<void> {
  if (process.killed || process.exitCode !== null) {
    return;
  }

  logger.info(`[${target}] 正在终止服务器进程`);

  try {
    // 先尝试优雅关闭
    process.kill('SIGTERM');

    // 等待进程退出，最多等待 PROCESS_SHUTDOWN_TIMEOUT 毫秒
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        process.once('exit', () => resolve(true));
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), PROCESS_SHUTDOWN_TIMEOUT);
      }),
    ]);

    if (!exited) {
      // 如果进程没有退出，强制终止
      logger.warning(`[${target}] 进程未在 ${PROCESS_SHUTDOWN_TIMEOUT}ms 内退出，强制终止`);
      process.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        process.once('exit', () => resolve());
        setTimeout(() => resolve(), 1000);
      });
    }

    logger.info(`[${target}] 服务器进程已终止`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[${target}] 终止进程时出错`, err);
  }
}

/**
 * 连接到 WebSocket 服务器并建立管道
 */
async function connectToServer(
  uri: string,
  target: string,
  serverConfig: ServerConfig
): Promise<void> {
  let process: ChildProcess | undefined;
  let websocket: WebSocket | undefined;

  try {
    logger.info(`[${target}] 正在连接到 WebSocket 服务器...`);

    websocket = new WebSocket(uri);

    await new Promise<void>((resolve, reject) => {
      const openHandler = () => {
        logger.info(`[${target}] 成功连接到 WebSocket 服务器`);
        websocket!.off('open', openHandler);
        websocket!.off('error', errorHandler);
        resolve();
      };

      const errorHandler = (error: Error) => {
        websocket!.off('open', openHandler);
        websocket!.off('error', errorHandler);
        reject(error);
      };

      websocket!.on('open', openHandler);
      websocket!.on('error', errorHandler);
    });

    // 启动服务器进程
    const { cmd, env } = buildServerCommand(target, serverConfig);
    process = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env,
    });

    logger.info(`[${target}] 已启动服务器进程: ${cmd.join(' ')}`);

    // 创建三个管道任务
    const wsToProcess = pipeWebSocketToProcess(websocket, process, target);
    const processToWs = pipeProcessToWebSocket(process, websocket, target);
    const stderrPipe = pipeProcessStderrToTerminal(process, target);

    // 等待任一任务完成（WebSocket 关闭或进程退出）
    await Promise.race([
      wsToProcess.then(async () => {
        // WebSocket 关闭，关闭 stdin 让进程知道没有更多输入
        if (process && process.stdin && !process.stdin.destroyed) {
          process.stdin.end();
        }
        // 等待进程退出（最多 PROCESS_SHUTDOWN_TIMEOUT 毫秒）
        await Promise.race([
          new Promise<void>((resolve) => {
            if (process) {
              process.once('exit', () => resolve());
            } else {
              resolve();
            }
          }),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), PROCESS_SHUTDOWN_TIMEOUT);
          }),
        ]);
        // 等待其他管道任务完成
        return Promise.all([processToWs, stderrPipe]);
      }),
      processToWs.then(() => {
        // 进程退出，等待其他任务完成
        return Promise.all([wsToProcess.catch(() => {}), stderrPipe]);
      }),
    ]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.includes('WebSocket') || websocket?.readyState === WebSocket.CLOSED) {
      logger.error(`[${target}] WebSocket 连接关闭`, err);
    } else {
      logger.error(`[${target}] 连接错误`, err);
    }
    throw err;
  } finally {
    // 清理资源
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.close();
    }

    if (process) {
      await terminateProcess(process, target);
    }
  }
}

/**
 * 使用重试机制连接到 WebSocket 服务器
 */
async function connectWithRetry(
  uri: string,
  target: string,
  serverConfig: ServerConfig
): Promise<void> {
  let reconnectAttempt = 0;
  let backoff = INITIAL_BACKOFF;

  while (true) {
    try {
      if (reconnectAttempt > 0) {
        logger.info(
          `[${target}] 等待 ${backoff}s 后进行第 ${reconnectAttempt} 次重连尝试...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
      }

      // 尝试连接
      await connectToServer(uri, target, serverConfig);
      // 如果连接成功，重置重连计数
      reconnectAttempt = 0;
      backoff = INITIAL_BACKOFF;
    } catch (error) {
      reconnectAttempt++;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warning(
        `[${target}] 连接关闭（尝试 ${reconnectAttempt}）: ${err.message}`
      );
      // 计算下次重连的等待时间（指数退避）
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

/**
 * 信号处理器
 */
function signalHandler(sig: string): void {
  logger.info(`收到中断信号 ${sig}，正在关闭...`);
  process.exit(0);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 注册信号处理器
  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));

  // 从环境变量获取 WebSocket 端点
  const endpointUrl = process.env.MCP_ENDPOINT;
  if (!endpointUrl) {
    logger.error('请设置 `MCP_ENDPOINT` 环境变量');
    process.exit(1);
  }

  // 从配置文件加载所有启用的服务器
  const cfg = loadConfig();
  const serversCfg = cfg.mcpServers || {};
  const enabled = getEnabledServers(cfg);
  const skipped = Object.keys(serversCfg).filter((name) => !enabled.includes(name));

  if (skipped.length > 0) {
    logger.info(`跳过禁用的服务器: ${skipped.join(', ')}`);
  }
  if (enabled.length === 0) {
    throw new Error('配置中未找到启用的 mcpServers');
  }
  logger.info(`正在启动服务器: ${enabled.join(', ')}`);

  // 启动所有服务器（并行）
  const tasks = enabled.map((target) => {
    const serverConfig = serversCfg[target];
    if (!serverConfig) {
      throw new Error(`服务器 '${target}' 配置不存在`);
    }
    return connectWithRetry(endpointUrl, target, serverConfig);
  });

  // 永远运行所有任务；如果任何任务崩溃，它会在内部自动重试
  await Promise.all(tasks);
}

// 运行主函数
main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(`程序执行错误`, err);
  process.exit(1);
});
