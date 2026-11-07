// 最先加载：读取 .env（Node 20.12+ 内置），已存在的环境变量优先
try {
  process.loadEnvFile();
} catch {
  /* 没有 .env 文件时忽略 */
}
