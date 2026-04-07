/**
 * 配置加载和验证工具
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MCPConfig, ServerConfig, TransportType } from '../types/config.js';
import { logger } from './logger.js';

const DEFAULT_CONFIG_PATH = './mcp_config.json';

/**
 * 递归展开配置值中的 ${ENV_VAR} 环境变量引用
 */
function expandEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // 匹配 ${ENV_VAR} 格式
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        logger.debug(`环境变量 ${varName} 未定义，使用空字符串`);
        return '';
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVariables);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVariables(value);
    }
    return result;
  }
  return obj;
}

/**
 * 加载配置文件
 * 从 $MCP_CONFIG 或 ./mcp_config.json 加载 JSON 配置
 */
export function loadConfig(): MCPConfig {
  const configPath =
    process.env.MCP_CONFIG || path.join(process.cwd(), DEFAULT_CONFIG_PATH);

  if (!fs.existsSync(configPath)) {
    // 检查是否设置了自定义路径
    if (process.env.MCP_CONFIG) {
      logger.error(`配置文件不存在: ${configPath}`);
      logger.info(`请检查 $MCP_CONFIG 环境变量是否指向正确的配置文件路径`);
    } else {
      logger.error(`默认配置文件不存在: ${configPath}`);
      logger.info(`请创建配置文件，或设置 $MCP_CONFIG 环境变量指向配置文件`);
      logger.info(`配置文件应包含 mcpServers 对象的 JSON 格式`);
    }
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as MCPConfig;

    // 展开环境变量
    const expandedConfig = expandEnvVariables(config) as MCPConfig;

    validateConfig(expandedConfig);
    return expandedConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.error(`配置文件格式错误: ${configPath}`);
      logger.info(`请确保 JSON 格式正确（检查逗号、引号等）`);
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`加载配置 ${configPath} 失败: ${err.message}`);
    }
    return {};
  }
}

/**
 * 验证配置的有效性
 */
function validateConfig(config: MCPConfig): void {
  if (!config.mcpServers) {
    logger.info(`配置文件中未找到 mcpServers 配置`);
    return;
  }

  const entries = Object.entries(config.mcpServers);
  if (entries.length === 0) {
    logger.warning(`mcpServers 配置为空`);
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
      // 验证 URL 格式
      try {
        new URL(serverConfig.url);
      } catch {
        throw new Error(`服务器 '${name}' 的 url 格式无效: ${serverConfig.url}`);
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
