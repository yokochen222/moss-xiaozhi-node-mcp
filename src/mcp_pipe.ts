#!/usr/bin/env node

/**
 * MCP stdio <-> WebSocket 管道程序
 * 版本: 0.4.0
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
import { connectMCPHTTPWithRetry } from './utils/mcp_http_client.js';
import type { ServerConfig } from './types/config.js';

// 自动加载 .env 文件中的环境变量
config();

// 重连设置
const INITIAL_BACKOFF = 1;       // 初始等待时间（秒）
const MAX_BACKOFF = 600;          // 最大等待时间（秒）
const PROCESS_SHUTDOWN_TIMEOUT = 5000;  // 进程关闭超时时间（毫秒）

// 全局关闭标志
let isShuttingDown = false;

/**
 * 安全地清理事件监听器
 */
function cleanupListeners(
  process: ChildProcess,
  websocket?: WebSocket
): void {
  // 清理 stdout 监听器
  if (process.stdout) {
    process.stdout.removeAllListeners('data');
    process.stdout.removeAllListeners('end');
    process.stdout.removeAllListeners('error');
  }
  // 清理 stderr 监听器
  if (process.stderr) {
    process.stderr.removeAllListeners('data');
    process.stderr.removeAllListeners('end');
    process.stderr.removeAllListeners('error');
  }
  // 清理进程 exit 监听器
  process.removeAllListeners('exit');
  // 清理 WebSocket 监听器
  if (websocket) {
    websocket.removeAllListeners('message');
    websocket.removeAllListeners('close');
    websocket.removeAllListeners('error');
  }
}

/**
 * 从 WebSocket 读取数据并写入进程 stdin
 */
async function pipeWebSocketToProcess(
  websocket: WebSocket,
  process: ChildProcess,
  target: string,
  onWebSocketClose: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      websocket.off('message', messageHandler);
      websocket.off('close', closeHandler);
      websocket.off('error', errorHandler);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const messageHandler = (message: WebSocket.Data) => {
      try {
        const data =
          message instanceof Buffer ? message.toString('utf-8') : String(message);
        logger.debug(`[websocket] << ${data.substring(0, 120)}${data.length > 120 ? '...' : ''}`);

        if (!process.stdin || process.stdin.destroyed) {
          logger.warning(`[websocket] 进程 stdin 不可用，丢弃消息`);
          done(new Error('进程 stdin 不可用'));
          return;
        }

        // MCP 协议使用换行符分隔的 JSON-RPC 消息
        const messageToSend = data.endsWith('\n') ? data : data + '\n';
        const canWrite = process.stdin.write(messageToSend);

        if (!canWrite) {
          logger.debug(`[websocket] stdin 缓冲区已满，等待 drain 事件`);
          process.stdin.once('drain', () => {
            logger.debug(`[websocket] stdin 缓冲区已清空`);
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`[websocket] WebSocket 到进程管道错误`, err);
        done(err);
      }
    };

    const closeHandler = () => {
      logger.info(`[websocket] WebSocket 连接已关闭`);
      onWebSocketClose();
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      done();
    };

    const errorHandler = (error: Error) => {
      logger.error(`[websocket] WebSocket 错误`, error);
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      done(error);
    };

    websocket.on('message', messageHandler);
    websocket.on('close', closeHandler);
    websocket.on('error', errorHandler);
  });
}

/**
 * 从进程 stdout 读取数据并发送到 WebSocket
 */
async function pipeProcessToWebSocket(
  process: ChildProcess,
  websocket: WebSocket,
  target: string,
  onProcessExit: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.stdout) {
      reject(new Error('进程没有 stdout'));
      return;
    }

    let resolved = false;
    let buffer = '';
    process.stdout.setEncoding('utf-8');

    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      // 清理所有监听器
      process.stdout?.removeAllListeners('data');
      process.stdout?.removeAllListeners('end');
      process.stdout?.removeAllListeners('error');
      process.removeAllListeners('exit');
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const dataHandler = (data: string) => {
      if (websocket.readyState === WebSocket.OPEN) {
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            logger.debug(`[websocket] >> ${line.substring(0, 120)}${line.length > 120 ? '...' : ''}`);
            websocket.send(line);
          }
        }
      }
    };

    const endHandler = () => {
      if (buffer.trim() && websocket.readyState === WebSocket.OPEN) {
        logger.debug(`[websocket] >> ${buffer.substring(0, 120)}${buffer.length > 120 ? '...' : ''}`);
        websocket.send(buffer);
        buffer = '';
      }
      logger.info(`[websocket] 进程 stdout 已结束`);
      onProcessExit();
      done();
    };

    const errorHandler = (error: Error) => {
      logger.error(`[websocket] 进程 stdout 错误`, error);
      done(error);
    };

    const exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      logger.info(`[websocket] 进程已退出，代码: ${code}, 信号: ${signal}`);
      done();
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

    let resolved = false;
    const childStderr = process.stderr;
    childStderr.setEncoding('utf-8');

    const done = () => {
      if (resolved) return;
      resolved = true;
      childStderr.removeAllListeners('data');
      childStderr.removeAllListeners('end');
      childStderr.removeAllListeners('error');
      process.removeAllListeners('exit');
      resolve();
    };

    const dataHandler = (data: string) => {
      const globalStderr = globalThis.process.stderr;
      if (globalStderr) {
        globalStderr.write(data);
      }
    };

    const endHandler = () => {
      logger.info(`[websocket] 进程 stderr 输出已结束`);
      done();
    };

    const errorHandler = () => {
      logger.warning(`[websocket] 进程 stderr 错误`);
    };

    const exitHandler = () => {
      done();
    };

    childStderr.on('data', dataHandler);
    childStderr.on('end', endHandler);
    childStderr.on('error', errorHandler);
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

  logger.info(`[websocket] 正在终止服务器进程`);

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
      logger.warning(`[websocket] 进程未在 ${PROCESS_SHUTDOWN_TIMEOUT}ms 内退出，强制终止`);
      process.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        process.once('exit', () => resolve());
        setTimeout(() => resolve(), 1000);
      });
    }

    logger.info(`[websocket] 服务器进程已终止`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[websocket] 终止进程时出错`, err);
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
    logger.info(`[websocket] 正在连接到 WebSocket 服务器`);

    websocket = new WebSocket(uri);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const openHandler = () => {
        if (settled) return;
        settled = true;
        logger.info(`[websocket] ✅ 成功连接`);
        websocket!.off('open', openHandler);
        websocket!.off('error', errorHandler);
        resolve();
      };

      const errorHandler = (error: unknown) => {
        if (settled) return;
        settled = true;
        websocket!.off('open', openHandler);
        websocket!.off('error', errorHandler);
        // 构造有意义的错误信息
        const errorMsg = error instanceof Error
          ? error.message
          : typeof error === 'string' ? error
          : error ? String(error) : '未知错误';
        reject(new Error(errorMsg || 'WebSocket 连接失败'));
      };

      websocket!.on('open', openHandler);
      websocket!.on('error', errorHandler);

      // WebSocket 连接超时
      setTimeout(() => {
        if (!settled) {
          settled = true;
          websocket!.off('open', openHandler);
          websocket!.off('error', errorHandler);
          websocket!.terminate();
          reject(new Error('WebSocket 连接超时'));
        }
      }, 30000);
    });

    // 启动服务器进程
    const { cmd, env } = buildServerCommand(target, serverConfig);
    process = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env,
    });

    logger.info(`[${target}] 已启动服务器进程: ${cmd.join(' ')}`);

    // 连接断开/进程退出的标志
    let shouldReconnect = false;
    let disconnectReason = '';

    const onWebSocketClose = () => {
      if (!shouldReconnect) {
        shouldReconnect = true;
        disconnectReason = 'WebSocket 连接已关闭';
      }
    };

    const onProcessExit = () => {
      if (!shouldReconnect) {
        shouldReconnect = true;
        disconnectReason = '服务器进程已退出';
      }
    };

    // 创建三个管道任务
    const wsToProcess = pipeWebSocketToProcess(websocket, process, target, onWebSocketClose);
    const processToWs = pipeProcessToWebSocket(process, websocket, target, onProcessExit);
    const stderrPipe = pipeProcessStderrToTerminal(process, target);

    // 等待任一任务完成
    const completedTask = await Promise.race([wsToProcess, processToWs]);

    // 清理所有监听器（防止内存泄漏）
    cleanupListeners(process, websocket);

    // 等待其他管道任务完成
    await Promise.allSettled([wsToProcess, processToWs, stderrPipe]);

    // 清理监听器
    cleanupListeners(process, websocket);

    // 如果是非正常断开，抛出错误以触发重连
    if (shouldReconnect && !isShuttingDown) {
      throw new Error(`[websocket] ${disconnectReason}，准备重连`);
    }
  } catch (error) {
    // 构造有意义的错误信息
    const errorMsg = error instanceof Error
      ? error.message
      : typeof error === 'string' ? error
      : error ? String(error) : '未知错误';
    const err = error instanceof Error ? error : new Error(errorMsg || '连接错误');

    if (err.message.includes('WebSocket') || err.message.includes('超时') ||
        websocket?.readyState === WebSocket.CLOSED || websocket?.readyState === WebSocket.CLOSING) {
      logger.error(`[websocket] ❌ WebSocket 连接失败 (${uri}): ${err.message}`);
    } else {
      logger.error(`[websocket] ❌ 连接错误 (${uri}): ${err.message}`);
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

  while (!isShuttingDown) {
    try {
      if (reconnectAttempt > 0) {
        logger.info(
          `[websocket]⏳ 等待 ${backoff}s 后进行第 ${reconnectAttempt} 次重连尝试 (${uri})...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
      }

      // 尝试连接
      await connectToServer(uri, target, serverConfig);

      // 如果连接成功（正常退出循环），重置重连计数
      reconnectAttempt = 0;
      backoff = INITIAL_BACKOFF;

      // 如果是正常关闭，不再重连
      if (isShuttingDown) {
        break;
      }
    } catch (error) {
      // 检查是否正在关闭
      if (isShuttingDown) {
        logger.info(`[websocket]正在关闭，跳过重连`);
        break;
      }

      reconnectAttempt++;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warning(
        `[websocket] ❌ 连接失败 (${uri})，尝试 ${reconnectAttempt}: ${err.message}`
      );
      // 计算下次重连的等待时间（指数退避）
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

/**
 * 信号处理器 - 优雅关闭
 */
function signalHandler(sig: string): void {
  if (isShuttingDown) {
    logger.warning(`[websocket]正在关闭中，请等待...`);
    return;
  }

  logger.info(`[websocket]收到中断信号 ${sig}，开始优雅关闭...`);
  isShuttingDown = true;

  // 给服务器一点时间处理
  setTimeout(() => {
    logger.info('[websocket]所有服务器正在关闭，程序即将退出');
    process.exit(0);
  }, 1000);
}

/**
 * 清理所有服务器进程
 */
async function cleanupAllServers(serverProcesses: Map<string, ChildProcess>): Promise<void> {
  logger.info(`[websocket]正在关闭 ${serverProcesses.size} 个服务器进程...`);

  const cleanupPromises: Promise<void>[] = [];

  for (const [target, proc] of serverProcesses.entries()) {
    cleanupPromises.push(
      (async () => {
        try {
          await terminateProcess(proc, target);
        } catch (e) {
          logger.warning(`[websocket] 关闭时出错: ${e}`);
        }
      })()
    );
  }

  await Promise.allSettled(cleanupPromises);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 注册信号处理器
  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));

  // 捕获未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的 Promise 拒绝', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // 捕获未处理的异常
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常', error);
    isShuttingDown = true;
    process.exit(1);
  });

  // 从环境变量获取 WebSocket 端点
  const endpointUrl = process.env.MCP_ENDPOINT;
  if (!endpointUrl) {
    logger.error('请设置 `MCP_ENDPOINT` 环境变量');
    logger.info('例如: export MCP_ENDPOINT=ws://localhost:8080/mcp');
    process.exit(1);
  }

  // 验证 WebSocket URL 格式
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointUrl);
    logger.info(`[websocket] 端点: ${parsedUrl.href}`);
  } catch {
    logger.error(`无效的 WebSocket URL: ${endpointUrl}`);
    logger.info('URL 格式应为: ws://host:port/path 或 wss://host:port/path');
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
    logger.error('配置中未找到启用的 mcpServers');
    logger.info('请在 mcp_config.json 中至少启用一个服务器，或检查 $MCP_CONFIG 路径');
    process.exit(1);
  }
  logger.info(`正在启动服务器: ${enabled.join(', ')}`);

  // 分离 stdio 和 HTTP 类型的服务器
  const stdioServers: string[] = [];
  const httpServers: string[] = [];

  for (const target of enabled) {
    const serverConfig = serversCfg[target];
    if (!serverConfig) {
      throw new Error(`服务器 '${target}' 配置不存在`);
    }

    const type = (serverConfig.type || serverConfig.transportType || 'stdio').toLowerCase();
    if (type === 'stdio') {
      stdioServers.push(target);
    } else if (type === 'sse' || type === 'http' || type === 'streamablehttp') {
      httpServers.push(target);
    } else {
      logger.warning(`[websocket] 跳过不支持的传输类型: ${type}`);
    }
  }

  logger.info(`STDIO 服务器: ${stdioServers.join(', ') || '无'}`);
  logger.info(`HTTP 服务器: ${httpServers.join(', ') || '无'}`);

  // 启动所有服务器（并行）
  const tasks: Promise<void>[] = [];

  // stdio 服务器使用现有的子进程方式
  for (const target of stdioServers) {
    const serverConfig = serversCfg[target];
    if (!serverConfig) {
      throw new Error(`服务器 '${target}' 配置不存在`);
    }
    tasks.push(connectWithRetry(endpointUrl, target, serverConfig));
  }

  // HTTP 服务器使用新的 MCP HTTP 客户端
  for (const target of httpServers) {
    const serverConfig = serversCfg[target];
    if (!serverConfig) {
      throw new Error(`服务器 '${target}' 配置不存在`);
    }
    tasks.push(connectMCPHTTPWithRetry(endpointUrl, target, serverConfig));
  }

  // 永远运行所有任务；如果任何任务崩溃，它会在内部自动重试
  await Promise.all(tasks);
}

// 运行主函数
main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(`程序执行错误`, err);
  process.exit(1);
});
