/**
 * MCP StreamableHTTP 客户端
 * 使用 @modelcontextprotocol/sdk 实现纯 Node.js 的 HTTP 传输
 */

import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.js';
import type { ServerConfig } from '../types/config.js';

const INITIAL_BACKOFF = 1;
const MAX_BACKOFF = 600;
const HTTP_CONNECT_TIMEOUT = 30000;  // HTTP 连接超时（毫秒）
const WEBSOCKET_CONNECT_TIMEOUT = 30000;  // WebSocket 连接超时（毫秒）

interface MCPHTTPConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  websocket: WebSocket;
  abortController: AbortController;
}

/**
 * 构建 WebSocket URL
 * 将 http/https 转换为 ws/wss
 */
function buildWebSocketUrl(httpUrl: string): string {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  } catch {
    // 如果解析失败，使用简单的替换
    return httpUrl.replace(/^http/, 'ws');
  }
}

/**
 * 带超时的 Promise 封装
 */
function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} 超时 (${ms}ms)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 从 WebSocket 读取数据并通过 MCP 客户端发送到 MCP HTTP 服务器
 */
async function pipeWebSocketToMCP(
  websocket: WebSocket,
  client: Client,
  transport: StreamableHTTPClientTransport,
  target: string,
  onDisconnect: () => void
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

    const messageHandler = async (message: WebSocket.Data) => {
      try {
        const data =
          message instanceof Buffer ? message.toString('utf-8') : String(message);
        logger.debug(`[${target}] WS << ${data.substring(0, 120)}${data.length > 120 ? '...' : ''}`);

        // 解析 JSON-RPC 消息
        let parsedMessage: JSONRPCMessage;
        try {
          parsedMessage = JSON.parse(data);
        } catch {
          logger.debug(`[${target}] 无效的 JSON 消息`);
          return;
        }

        // 通过 transport 发送消息
        await transport.send(parsedMessage);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`[${target}] WebSocket 到 MCP 管道错误`, err);
        done(err);
      }
    };

    const closeHandler = () => {
      logger.info(`[${target}] WebSocket 连接已关闭`);
      onDisconnect();
      done();
    };

    const errorHandler = (error: Error) => {
      logger.error(`[${target}] WebSocket 错误`, error);
      done(error);
    };

    websocket.on('message', messageHandler);
    websocket.on('close', closeHandler);
    websocket.on('error', errorHandler);
  });
}

/**
 * 从 MCP 客户端读取消息并发送到 WebSocket
 */
async function pipeMCPToWebSocket(
  client: Client,
  transport: StreamableHTTPClientTransport,
  websocket: WebSocket,
  target: string,
  onDisconnect: () => void
): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    // 监听 transport 的消息事件
    transport.onmessage = (message: JSONRPCMessage) => {
      if (websocket.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify(message);
        logger.debug(`[${target}] MCP >> ${msg.substring(0, 120)}${msg.length > 120 ? '...' : ''}`);
        websocket.send(msg);
      }
    };

    transport.onerror = (error: Error) => {
      logger.error(`[${target}] MCP 传输错误`, error);
    };

    transport.onclose = () => {
      logger.info(`[${target}] MCP 传输已关闭`);
      onDisconnect();
      done();
    };

    // 监听 WebSocket 关闭
    websocket.on('close', () => {
      logger.info(`[${target}] WebSocket 已关闭 (MCP -> WS)`);
      onDisconnect();
      done();
    });

    websocket.on('error', () => {
      logger.info(`[${target}] WebSocket 错误 (MCP -> WS)`);
      onDisconnect();
      done();
    });
  });
}

/**
 * 连接到 MCP HTTP 服务器
 */
async function connectToMCPHTTP(
  uri: string,
  target: string,
  serverConfig: ServerConfig
): Promise<void> {
  let connection: MCPHTTPConnection | undefined;

  try {
    logger.info(`[${target}] 正在连接到 MCP HTTP 服务器: ${uri}`);

    // 构建请求头
    const headers: Record<string, string> = {};
    if (serverConfig.headers) {
      for (const [key, value] of Object.entries(serverConfig.headers)) {
        headers[key] = String(value);
      }
    }

    // 创建 AbortController 用于超时控制
    const abortController = new AbortController();
    const httpTimeout = setTimeout(() => {
      abortController.abort(new Error('HTTP 连接超时'));
    }, HTTP_CONNECT_TIMEOUT);

    // 创建 MCP 客户端
    const client = new Client(
      {
        name: 'moss-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // 创建 HTTP 传输
    const url = new URL(serverConfig.url || uri);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    });

    // 连接 MCP 客户端（带超时）
    try {
      await withTimeout(
        client.connect(transport, { signal: abortController.signal }),
        HTTP_CONNECT_TIMEOUT,
        'MCP HTTP 连接'
      );
    } finally {
      clearTimeout(httpTimeout);
    }

    // 验证 sessionId
    if (!transport.sessionId) {
      logger.warning(`[${target}] MCP HTTP 服务器未返回 Session ID，可能不支持会话管理`);
    } else {
      logger.info(`[${target}] MCP HTTP 客户端已连接，Session ID: ${transport.sessionId}`);
    }

    // 构建 WebSocket URL
    const wsUrl = buildWebSocketUrl(uri);
    logger.info(`[${target}] 正在连接到 WebSocket: ${wsUrl}`);

    const websocket = new WebSocket(wsUrl);

    // WebSocket 连接超时
    const wsTimeout = setTimeout(() => {
      websocket.terminate();
      abortController.abort(new Error('WebSocket 连接超时'));
    }, WEBSOCKET_CONNECT_TIMEOUT);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const openHandler = () => {
        if (settled) return;
        settled = true;
        clearTimeout(wsTimeout);
        websocket.off('open', openHandler);
        websocket.off('error', errorHandler);
        resolve();
      };

      const errorHandler = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(wsTimeout);
        websocket.off('open', openHandler);
        websocket.off('error', errorHandler);
        const errorMsg = error instanceof Error
          ? error.message
          : typeof error === 'string' ? error
          : error ? String(error) : '未知错误';
        reject(new Error(errorMsg || 'WebSocket 连接失败'));
      };

      websocket.on('open', openHandler);
      websocket.on('error', errorHandler);
    });

    logger.info(`[${target}] WebSocket 连接已建立`);
    connection = { client, transport, websocket, abortController };

    // 断开连接标志，用于触发重连
    let shouldReconnect = false;
    let disconnectReason = '';

    const onDisconnect = () => {
      if (!shouldReconnect) {
        shouldReconnect = true;
        disconnectReason = '检测到连接断开';
      }
    };

    // 创建管道任务
    const wsToMCP = pipeWebSocketToMCP(websocket, client, transport, target, onDisconnect);
    const mcpToWs = pipeMCPToWebSocket(client, transport, websocket, target, onDisconnect);

    // 等待任一任务完成
    await Promise.race([wsToMCP, mcpToWs]);

    // 如果是因为断开而结束，抛出错误以触发重连
    if (shouldReconnect) {
      throw new Error(`[${target}] ${disconnectReason}，准备重连`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error
      ? error.message
      : typeof error === 'string' ? error
      : error ? String(error) : '未知错误';
    const err = error instanceof Error ? error : new Error(errorMsg || '连接错误');
    logger.error(`[${target}] 连接错误: ${err.message}`);
    throw err;
  } finally {
    if (connection) {
      const { client, transport, websocket, abortController } = connection;

      // 取消任何进行中的请求
      abortController.abort();

      // 关闭 WebSocket
      if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
        websocket.close();
      }

      // 关闭 MCP 传输
      try {
        transport.close();
      } catch (e) {
        logger.debug(`[${target}] 关闭传输时出错: ${e}`);
      }

      // 关闭 MCP 客户端
      try {
        client.close();
      } catch (e) {
        logger.debug(`[${target}] 关闭客户端时出错: ${e}`);
      }

      logger.info(`[${target}] MCP HTTP 连接已清理`);
    }
  }
}

/**
 * 使用重试机制连接到 MCP HTTP 服务器
 */
export async function connectMCPHTTPWithRetry(
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

      await connectToMCPHTTP(uri, target, serverConfig);
      reconnectAttempt = 0;
      backoff = INITIAL_BACKOFF;
    } catch (error) {
      reconnectAttempt++;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warning(
        `[${target}] 连接失败（尝试 ${reconnectAttempt}）: ${err.message}`
      );
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}
