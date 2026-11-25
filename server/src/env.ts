import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 在其它模块读取 process.env 之前加载 .env。
 * 必须作为入口的第一个 import，ESM 会按声明顺序先执行它的副作用。
 *
 * 不用 process.loadEnvFile：Windows 上用记事本/PowerShell 写出的 .env 常带 UTF-8 BOM，
 * 它会让第一个键名变成 "\uFEFFLANGFUSE_PUBLIC_KEY"，配置看起来写了却完全不生效。
 */
const envPath = resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 真实环境变量优先于 .env
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
