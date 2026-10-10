export const LogLevel = {
  Off: 0,
  Error: 1,
  Warn: 2,
  Info: 3,
  Debug: 4,
  Trace: 5,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

let currentLevel: number = LogLevel.Warn;
type Sink = (levelName: string, message: string) => void;
let sink: Sink | null = null;

export function setLogLevel(level: number): void {
  currentLevel = level;
}
export function getLogLevel(): number {
  return currentLevel;
}
/** Override the destination for log messages (defaults to the console). */
export function setLogSink(fn: Sink | null): void {
  sink = fn;
}

function emit(severity: number, name: string, message: string): void {
  if (severity > currentLevel) return;
  if (sink) {
    sink(name, message);
    return;
  }
  if (name === 'ERROR') console.error(message);
  else if (name === 'WARN') console.warn(message);
  else console.log(message);
}

export const logError = (message: string): void => emit(LogLevel.Error, 'ERROR', message);
export const logWarn = (message: string): void => emit(LogLevel.Warn, 'WARN', message);
export const logInfo = (message: string): void => emit(LogLevel.Info, 'INFO', message);
export const logDebug = (message: string): void => emit(LogLevel.Debug, 'DEBUG', message);
export const logTrace = (message: string): void => emit(LogLevel.Trace, 'TRACE', message);
