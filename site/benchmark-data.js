// The charts and animation share this adapter to the canonical CLI benchmark.
export const ENGINES = [
  { id: 'rust', label: 'Rust oxipng', color: '#e39060', sizeKey: 'nativeSize', timeKey: 'nativeMs' },
  { id: 'node', label: 'Node.js', color: '#8fbe85', sizeKey: 'tsSize', timeKey: 'tsCliMs' },
  { id: 'porffor', label: 'Porffor', color: '#b69bd2', sizeKey: 'porfforSize', timeKey: 'porfforMs' },
  { id: 'scriptc', label: 'ScriptC', color: '#8ebac6', sizeKey: 'scriptcSize', timeKey: 'scriptcMs' },
];

function number(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`benchmark 中的 ${label} 无效`);
  }
  return value;
}

export function normalizeBenchmark(report) {
  if (!report || !Array.isArray(report.rows) || report.rows.length === 0 ||
      typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) {
    throw new Error('benchmark 缺少有效的样本或生成时间');
  }
  const runs = number(report.options?.runs, 'runs', 1);
  const warmup = number(report.options?.warmup, 'warmup');
  const startupRuns = report.options?.startupRuns == null
    ? null
    : number(report.options.startupRuns, 'startupRuns', 1);
  const timeAggregation = report.options?.timeAggregation ?? 'fastest';
  const opt = String(report.options?.opt ?? '');
  if (!/^[0-6]$/.test(opt) || !Number.isInteger(runs) || !Number.isInteger(warmup) ||
      (startupRuns !== null && !Number.isInteger(startupRuns)) ||
      !['fastest', 'drop-fastest-mean'].includes(timeAggregation)) {
    throw new Error('benchmark 测量选项无效');
  }
  const activeEngines = ENGINES.filter(engine => ['rust', 'node'].includes(engine.id) ||
    report[engine.id] !== undefined || report.rows.some(row => row[engine.sizeKey] !== undefined || row[engine.timeKey] !== undefined));
  const rows = report.rows.map((row, index) => {
    if (typeof row.name !== 'string' || !row.name) throw new Error('benchmark 样本名称无效');
    const inputBytes = number(row.originalSize, `${row.name} 原始尺寸`, 1);
    const engines = activeEngines.map(engine => ({
      ...engine,
      bytes: number(row[engine.sizeKey], `${row.name} ${engine.label} 尺寸`),
      ms: number(row[engine.timeKey], `${row.name} ${engine.label} 耗时`, Number.MIN_VALUE),
    }));
    return { id: String(index), name: row.name, inputBytes, engines };
  });
  const all = {
    id: 'all', name: `全部 ${rows.length} 张图片`,
    inputBytes: rows.reduce((sum, row) => sum + row.inputBytes, 0),
    engines: activeEngines.map((engine, index) => ({ ...engine,
      bytes: rows.reduce((sum, row) => sum + row.engines[index].bytes, 0),
      ms: rows.reduce((sum, row) => sum + row.engines[index].ms, 0),
    })),
  };
  const startupValues = {
    rust: report.native?.startupMs ?? report.totals?.nativeStartupMs,
    node: report.ts?.cliStartupMs ?? report.totals?.tsCliStartupMs,
    porffor: report.porffor?.startupMs ?? report.totals?.porfforStartupMs,
    scriptc: report.scriptc?.startupMs ?? report.totals?.scriptcStartupMs,
  };
  const startups = activeEngines.map(engine => {
    const value = startupValues[engine.id];
    return { ...engine, startupMs: value == null ? null : number(value, `${engine.label} 启动耗时`) };
  });
  const environment = report.environment ?? {};
  return {
    generatedAt: report.generatedAt,
    options: { opt, runs, warmup, startupRuns, timeAggregation },
    rows, all, startups,
    environment: {
      cpu: typeof environment.cpu === 'string' ? environment.cpu : '未记录 CPU',
      platform: typeof environment.platform === 'string' ? environment.platform : '未记录系统',
      arch: typeof environment.arch === 'string' ? environment.arch : '',
      node: typeof environment.node === 'string' ? environment.node : '',
    },
    versions: {
      rust: report.native?.version ?? 'Rust oxipng',
      node: `Node.js ${environment.node ?? ''}`.trim(),
      porffor: report.porffor?.version ?? 'Porffor',
      scriptc: report.scriptc?.version ?? 'ScriptC',
    },
    matchingTs: report.rows.every(row => activeEngines.filter(engine => !['rust', 'node'].includes(engine.id))
      .every(engine => row[`${engine.id}MatchesTs`] === true)),
  };
}

/** Relative rate and traversal duration are both derived from the same times. */
export function raceMetrics(engines, playback = 1) {
  number(playback, '演示倍速', Number.MIN_VALUE);
  const fastestMs = Math.min(...engines.map(engine => number(engine.ms, '动画耗时', Number.MIN_VALUE)));
  return engines.map(engine => ({ ...engine,
    rate: fastestMs / engine.ms,
    durationMs: 1600 * engine.ms / fastestMs / playback,
  }));
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1048576).toFixed(2)} MiB`;
}

export function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(ms < 10 ? 3 : 2)} s`;
}
