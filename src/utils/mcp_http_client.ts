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

interface MCPHTTPConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  websocket: WebSocket;
}

/**
 * 从 WebSocket 读取数据并通过 MCP 客户端发送到 MCP HTTP 服务器
 */
async function pipeWebSocketToMCP(
  websocket: WebSocket,
  client: Client,
  transport: StreamableHTTPClientTransport,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const messageHandler = async (message: WebSocket.Data) => {
      try {
        const data =
          message instanceof Buffer ? message.toString('utf-8') : String(message);
        logger.debug(`[${target}] WS << ${data.substring(0, 120)}...`);

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
        reject(err);
      }
    };

    const closeHandler = () => {
      websocket.off('message', messageHandler);
      websocket.off('close', closeHandler);
      websocket.off('error', errorHandler);
      resolve();
    };

    const errorHandler = (error: Error) => {
      logger.error(`[${target}] WebSocket 错误`, error);
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
 * 从 MCP 客户端读取消息并发送到 WebSocket
 */
async function pipeMCPToWebSocket(
  client: Client,
  transport: StreamableHTTPClientTransport,
  websocket: WebSocket,
  target: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 监听 transport 的消息事件
    transport.onmessage = (message: JSONRPCMessage) => {
      if (websocket.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify(message);
        logger.debug(`[${target}] MCP >> ${msg.substring(0, 120)}...`);
        websocket.send(msg);
      }
    };

    transport.onerror = (error: Error) => {
      logger.error(`[${target}] MCP 传输错误`, error);
    };

    transport.onclose = () => {
      logger.info(`[${target}] MCP 传输已关闭`);
      resolve();
    };

    // 监听 WebSocket 关闭
    websocket.on('close', () => {
      resolve();
    });

    websocket.on('error', () => {
      resolve();
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

    // 连接 MCP 客户端
    await client.connect(transport);
    logger.info(`[${target}] MCP HTTP 客户端已连接，Session ID: ${transport.sessionId}`);

    // 连接 WebSocket
    const wsUrl = uri.replace(/^http/, 'ws');
    logger.info(`[${target}] 正在连接到 WebSocket: ${wsUrl}`);

    const websocket = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const openHandler = () => {
        logger.info(`[${target}] WebSocket 连接已建立`);
        websocket.off('open', openHandler);
        websocket.off('error', errorHandler);
        resolve();
      };

      const errorHandler = (error: Error) => {
        websocket.off('open', openHandler);
        websocket.off('error', errorHandler);
        reject(error);
      };

      websocket.on('open', openHandler);
      websocket.on('error', errorHandler);
    });

    connection = { client, transport, websocket };

    // 创建管道任务
    const wsToMCP = pipeWebSocketToMCP(websocket, client, transport, target);
    const mcpToWs = pipeMCPToWebSocket(client, transport, websocket, target);

    // 等待任一任务完成
    await Promise.race([wsToMCP, mcpToWs]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[${target}] 连接错误`, err);
    throw err;
  } finally {
    if (connection) {
      const { client, transport, websocket } = connection;

      // 关闭 WebSocket
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }

      // 关闭 MCP 传输
      try {
        await transport.close();
      } catch (e) {
        logger.debug(`[${target}] 关闭传输时出错: ${e}`);
      }

      // 关闭 MCP 客户端
      try {
        await client.close();
      } catch (e) {
        logger.debug(`[${target}] 关闭客户端时出错: ${e}`);
      }

      logger.info(`[${target}] MCP HTTP 连接已关闭`);
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
        `[${target}] 连接关闭（尝试 ${reconnectAttempt}）: ${err.message}`
      );
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}
