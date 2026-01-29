/**
 * 配置加载和验证工具
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MCPConfig, ServerConfig, TransportType } from '../types/config.js';
import { logger } from './logger.js';

/**
 * 加载配置文件
 * 从 $MCP_CONFIG 或 ./mcp_config.json 加载 JSON 配置
 */
export function loadConfig(): MCPConfig {
  const configPath =
    process.env.MCP_CONFIG || path.join(process.cwd(), 'mcp_config.json');
  
  if (!fs.existsSync(configPath)) {
    logger.warning(`配置文件不存在: ${configPath}`);
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as MCPConfig;
    validateConfig(config);
    return config;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`加载配置 ${configPath} 失败`, err);
    return {};
  }
}

/**
 * 验证配置的有效性
 */
function validateConfig(config: MCPConfig): void {
  if (!config.mcpServers) {
    return;
  }

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if (serverConfig.disabled) {
      continue;
    }

    const type = (serverConfig.type || serverConfig.transportType || 'stdio').toLowerCase() as TransportType;

    if (type === 'stdio') {
      if (!serverConfig.command) {
        throw new Error(`服务器 '${name}' 缺少必需的 'command' 字段`);
      }
    } else if (type === 'sse' || type === 'http' || type === 'streamablehttp') {
      if (!serverConfig.url) {
        throw new Error(`服务器 '${name}' (类型 ${type}) 缺少必需的 'url' 字段`);
      }
    } else {
      throw new Error(`服务器 '${name}' 使用了不支持的传输类型: ${type}`);
    }
  }
}

/**
 * 获取所有启用的服务器名称
 */
export function getEnabledServers(config: MCPConfig): string[] {
  const serversCfg = config.mcpServers || {};
  return Object.keys(serversCfg).filter(
    (name) => !(serversCfg[name] || {}).disabled
  );
}
