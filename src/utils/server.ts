/**
 * 服务器命令构建工具
 */

import type { ServerCommand, ServerConfig, TransportType } from '../types/config.js';

/**
 * 构建服务器命令
 * 为给定的目标构建 [cmd,...] 和 env
 *
 * @param target - 配置中服务器的名称
 * @param serverConfig - 服务器配置对象
 * @returns 命令和环境变量
 */
export function buildServerCommand(
  target: string,
  serverConfig: ServerConfig
): ServerCommand {
  if (serverConfig.disabled) {
    throw new Error(`服务器 '${target}' 在配置中被禁用`);
  }

  const type = (
    serverConfig.type || serverConfig.transportType || 'stdio'
  ).toLowerCase() as TransportType;

  // 构建子进程的环境变量
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      childEnv[k] = v;
    }
  }
  if (serverConfig.env) {
    for (const [k, v] of Object.entries(serverConfig.env)) {
      childEnv[k] = String(v);
    }
  }

  if (type === 'stdio') {
    return buildStdioCommand(target, serverConfig, childEnv);
  }

  if (type === 'sse' || type === 'http' || type === 'streamablehttp') {
    return buildHttpCommand(target, serverConfig, type, childEnv);
  }

  throw new Error(`不支持的服务器类型: ${type}`);
}

/**
 * 构建 stdio 类型的命令
 */
function buildStdioCommand(
  target: string,
  config: ServerConfig,
  env: Record<string, string>
): ServerCommand {
  const command = config.command;
  const args = config.args || [];

  if (!command) {
    throw new Error(`服务器 '${target}' 缺少 'command'`);
  }

  return { cmd: [command, ...args], env };
}

/**
 * 构建 HTTP/SSE 类型的命令（使用 mcp-proxy）
 */
function buildHttpCommand(
  target: string,
  config: ServerConfig,
  type: TransportType,
  env: Record<string, string>
): ServerCommand {
  const url = config.url;
  if (!url) {
    throw new Error(`服务器 '${target}' (类型 ${type}) 缺少 'url'`);
  }

  // 使用 Python 运行 mcp-proxy 模块
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const cmd: string[] = [pythonCmd, '-m', 'mcp_proxy'];

  if (type === 'http' || type === 'streamablehttp') {
    cmd.push('--transport', 'streamablehttp');
  }

  // 添加可选的 headers
  if (config.headers) {
    for (const [hk, hv] of Object.entries(config.headers)) {
      cmd.push('-H', hk, String(hv));
    }
  }

  cmd.push(url);

  return { cmd, env };
}
