#!/usr/bin/env node

/**
 * MCP stdio <-> WebSocket 管道程序
 * 版本: 0.2.0
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
import chalk from 'chalk';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils';
import { config } from 'dotenv';

// 自动加载 .env 文件中的环境变量
config();



// 重连设置
const INITIAL_BACKOFF = 1; // 初始等待时间（秒）
const MAX_BACKOFF = 600; // 最大等待时间（秒）

/**
 * 配置文件的类型定义
 */
interface ServerConfig {
  type?: string;
  transportType?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
}

interface MCPConfig {
  mcpServers?: Record<string, ServerConfig>;
}

/**
 * 加载配置文件
 * 从 $MCP_CONFIG 或 ./mcp_config.json 加载 JSON 配置
 */
function loadConfig(): MCPConfig {
  const configPath =
    process.env.MCP_CONFIG || path.join(process.cwd(), 'mcp_config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as MCPConfig;
  } catch (error) {
    logger.warning(`加载配置 ${configPath} 失败: ${error}`);
    return {};
  }
}

/**
 * 构建服务器命令
 * 为给定的目标构建 [cmd,...] 和 env
 *
 * target 必须是 config.mcpServers 中配置的服务器名称
 */
function buildServerCommand(target: string): {
  cmd: string[];
  env: Record<string, string>;
} {
  const cfg = loadConfig();
  const servers = cfg.mcpServers || {};

  if (!(target in servers)) {
    throw new Error(`服务器 '${target}' 未在配置中找到`);
  }

  const entry = servers[target] || {};
  if (entry.disabled) {
    throw new Error(`服务器 '${target}' 在配置中被禁用`);
  }
  const typ = (
    entry.type || entry.transportType || 'stdio'
  ).toLowerCase();

  // 子进程的环境变量
  // 过滤掉 undefined 值，确保所有值都是 string
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      childEnv[k] = v;
    }
  }
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      childEnv[k] = String(v);
    }
  }

  if (typ === 'stdio') {
    const command = entry.command;
    const args = entry.args || [];
    if (!command) {
      throw new Error(`服务器 '${target}' 缺少 'command'`);
    }
    return { cmd: [command, ...args], env: childEnv };
  }

  if (typ === 'sse' || typ === 'http' || typ === 'streamablehttp') {
    const url = entry.url;
    if (!url) {
      throw new Error(`服务器 '${target}' (类型 ${typ}) 缺少 'url'`);
    }
    // 统一方法: 使用 Python 运行 mcp-proxy 模块
    // 优先使用 python3，如果不存在则使用 python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const cmd = [pythonCmd, '-m', 'mcp_proxy'];
    if (typ === 'http' || typ === 'streamablehttp') {
      cmd.push('--transport', 'streamablehttp');
    }
    // 可选的 headers: {"Authorization": "Bearer xxx"}
    if (entry.headers) {
      for (const [hk, hv] of Object.entries(entry.headers)) {
        cmd.push('-H', hk, String(hv));
      }
    }
    cmd.push(url);
    return { cmd, env: childEnv };
  }

  throw new Error(`不支持的服务器类型: ${typ}`);
}

/**
 * 从 WebSocket 读取数据并写入进程 stdin
 */
async function pipeWebSocketToProcess(
  websocket: WebSocket,
  process: ChildProcess,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    websocket.on('message', (message: WebSocket.Data) => {
      try {
        const data =
          message instanceof Buffer ? message.toString('utf-8') : String(message);
        logger.debug(`[${target}] << ${data.substring(0, 120)}...`);

        if (process.stdin && !process.stdin.destroyed) {
          // MCP 协议使用换行符分隔的 JSON-RPC 消息
          // 如果数据已经以换行符结尾，直接写入；否则添加换行符
          const message = data.endsWith('\n') ? data : data + '\n';
          process.stdin.write(message);
        }
      } catch (error) {
        logger.error(`[${target}] WebSocket 到进程管道错误: ${error}`);
        reject(error);
      }
    });

    websocket.on('close', () => {
      // 关闭进程 stdin
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      resolve();
    });

    websocket.on('error', (error) => {
      logger.error(`[${target}] WebSocket 错误: ${error}`);
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end();
      }
      reject(error);
    });
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
    
    process.stdout.on('data', (data: string) => {
      if (websocket.readyState === WebSocket.OPEN) {
        // 将新数据添加到缓冲区
        buffer += data;
        
        // 按行分割并发送完整的消息
        const lines = buffer.split('\n');
        // 保留最后一个不完整的行在缓冲区中
        buffer = lines.pop() || '';
        
        // 发送所有完整的行
        for (const line of lines) {
          if (line.trim()) {
            // 只发送非空行
            logger.debug(`[${target}] >> ${line.substring(0, 120)}...`);
            websocket.send(line);
          }
        }
      }
    });

    process.stdout.on('end', () => {
      // 发送缓冲区中剩余的数据（如果有）
      if (buffer.trim() && websocket.readyState === WebSocket.OPEN) {
        logger.debug(`[${target}] >> ${buffer.substring(0, 120)}...`);
        websocket.send(buffer);
        buffer = '';
      }
      logger.info(`[${target}] 进程输出已结束`);
      // 注意：stdout 结束不代表进程退出，不应该 resolve
      // 只有当进程真正退出时才 resolve
    });

    process.stdout.on('error', (error) => {
      logger.error(`[${target}] 进程到 WebSocket 管道错误: ${error}`);
      reject(error);
    });

    process.on('exit', (code, signal) => {
      logger.info(`[${target}] 进程退出，代码: ${code}, 信号: ${signal}`);
      resolve();
    });
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
    childStderr.on('data', (data: string) => {
      // 将子进程的 stderr 输出到当前进程的 stderr
      // 使用全局的 process.stderr（Writable 流）
      const globalStderr = globalThis.process.stderr;
      if (globalStderr) {
        globalStderr.write(data);
      }
    });

    childStderr.on('end', () => {
      logger.info(`[${target}] 进程 stderr 输出已结束`);
      // 注意：stderr 结束不代表进程退出，不应该 resolve
      // 只有当进程真正退出时才 resolve
    });

    process.on('exit', () => {
      resolve();
    });
  });
}

/**
 * 连接到 WebSocket 服务器并建立管道
 */
async function connectToServer(
  uri: string,
  target: string
): Promise<void> {
  let process: ChildProcess | undefined;
  let websocket: WebSocket | undefined;

  try {
    logger.info(`[${target}] 正在连接到 WebSocket 服务器...`);

    websocket = new WebSocket(uri);

    await new Promise<void>((resolve, reject) => {
      websocket!.on('open', () => {
        logger.info(`[${target}] 成功连接到 WebSocket 服务器`);
        resolve();
      });

      websocket!.on('error', (error) => {
        reject(error);
      });
    });

    // 启动服务器进程（从 CLI 参数或配置构建）
    const { cmd, env } = buildServerCommand(target);
    process = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env,
    });

    logger.info(`[${target}] 已启动服务器进程: ${cmd.join(' ')}`);

    // 创建三个任务: 从 WebSocket 读取并写入进程，从进程读取并写入 WebSocket，从进程 stderr 读取并输出到终端
    // 使用 Promise.race 来处理第一个完成的任务
    const wsToProcess = pipeWebSocketToProcess(websocket, process, target);
    const processToWs = pipeProcessToWebSocket(process, websocket, target);
    const stderrPipe = pipeProcessStderrToTerminal(process, target);
    
    // 等待任一任务完成（WebSocket 关闭或进程退出）
    await Promise.race([
      wsToProcess.then(() => {
        // WebSocket 关闭，关闭 stdin 让进程知道没有更多输入
        if (process && process.stdin && !process.stdin.destroyed) {
          process.stdin.end();
        }
        // 等待进程退出（最多 5 秒）
        return Promise.race([
          new Promise<void>((resolve) => {
            if (process) {
              process.once('exit', () => resolve());
            } else {
              resolve();
            }
          }),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 5000);
          }),
        ]).then(() => {
          // 等待其他管道任务完成
          return Promise.all([processToWs, stderrPipe]);
        });
      }),
      processToWs.then(() => {
        // 进程退出，等待其他任务完成
        return Promise.all([wsToProcess.catch(() => {}), stderrPipe]);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('WebSocket') || websocket?.readyState === WebSocket.CLOSED) {
        logger.error(`[${target}] WebSocket 连接关闭: ${error.message}`);
      } else {
        logger.error(`[${target}] 连接错误: ${error.message}`);
      }
    } else {
      logger.error(`[${target}] 连接错误: ${error}`);
    }
    throw error;
  } finally {
    // 关闭 WebSocket 连接
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.close();
    }

    // 确保子进程被正确终止（如果还在运行）
    if (process && !process.killed) {
      const proc = process;
      const isExited = new Promise<boolean>((resolve) => {
        if (proc.exitCode !== null) {
          resolve(true);
          return;
        }
        proc.once('exit', () => resolve(true));
        setTimeout(() => resolve(false), 100);
      });
      
      const exited = await isExited;
      if (!exited) {
        logger.info(`[${target}] 正在终止服务器进程`);
        try {
          proc.kill('SIGTERM');
          // 等待进程退出，最多等待 5 秒
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              if (proc && !proc.killed) {
                proc.kill('SIGKILL');
              }
              resolve();
            }, 5000);

            proc.on('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        } catch (error) {
          logger.error(`[${target}] 终止进程时出错: ${error}`);
        }
        logger.info(`[${target}] 服务器进程已终止`);
      }
    }
  }
}

/**
 * 使用重试机制连接到 WebSocket 服务器
 */
async function connectWithRetry(uri: string, target: string): Promise<void> {
  let reconnectAttempt = 0;
  let backoff = INITIAL_BACKOFF;

  while (true) {
    // 无限重连
    try {
      if (reconnectAttempt > 0) {
        logger.info(
          `[${target}] 等待 ${backoff}s 后进行第 ${reconnectAttempt} 次重连尝试...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
      }

      // 尝试连接
      await connectToServer(uri, target);
      // 如果连接成功，重置重连计数
      reconnectAttempt = 0;
      backoff = INITIAL_BACKOFF;
    } catch (error) {
      reconnectAttempt++;
      logger.warning(
        `[${target}] 连接关闭（尝试 ${reconnectAttempt}）: ${error}`
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
  logger.info('收到中断信号，正在关闭...');
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
  const allServers = Object.keys(serversCfg);
  const enabled = allServers.filter(
    (name) => !(serversCfg[name] || {}).disabled
  );
  const skipped = allServers.filter((name) => !enabled.includes(name));

  if (skipped.length > 0) {
    logger.info(`跳过禁用的服务器: ${skipped.join(', ')}`);
  }
  if (enabled.length === 0) {
    throw new Error('配置中未找到启用的 mcpServers');
  }
  logger.info(`正在启动服务器: ${enabled.join(', ')}`);

  // 启动所有服务器（并行）
  const tasks = enabled.map((target) =>
    connectWithRetry(endpointUrl, target)
  );
  // 永远运行所有任务；如果任何任务崩溃，它会在内部自动重试
  await Promise.all(tasks);
}

// 运行主函数
main().catch((error) => {
  logger.error(`程序执行错误: ${error}`);
  process.exit(1);
});
