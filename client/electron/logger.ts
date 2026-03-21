import log from 'electron-log';
import path from 'path';
import { app } from 'electron';

// 日志文件保存在: ~/Library/Logs/ArmorClaw/ (macOS) 或 %USERPROFILE%\AppData\Roaming\ArmorClaw\logs\ (Windows)
log.transports.file.resolvePathFn = () => {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  return path.join(logsDir, 'main.log');
};

// 文件日志配置
log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB 单文件上限
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// 控制台也保留输出（开发时方便）
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

export default log;
