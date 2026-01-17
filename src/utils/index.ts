import chalk from 'chalk';

// 日志配置
export const logger = {
  info: (msg: string) => console.log(chalk.green(`[INFO] ${new Date().toISOString()} - ${msg}`)),
  warning: (msg: string) => console.log(chalk.yellow(`[WARN] ${new Date().toISOString()} - ${msg}`)),
  error: (msg: string, error?: any) => console.log(chalk.red(`[ERROR] ${new Date().toISOString()} - ${msg} - ${error ? error.message : ''}`)),
  debug: (msg: string) => {
    // 可以通过环境变量控制是否输出 debug 日志
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[DEBUG] ${new Date().toISOString()} - ${msg}`));
    }
  },
};