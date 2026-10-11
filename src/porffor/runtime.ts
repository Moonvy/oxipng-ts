/** Minimal POSIX host for the shared CLI. Compiled only by Porffor, never shipped to Node. */
declare const Porffor: {
  c(strings: TemplateStringsArray): void;
  malloc(bytes: number): unknown;
  as<T>(value: unknown, type: number): T;
  TYPES: { bytestring: number };
};

// Porffor.c refers to local names directly. Keep this file outside the bundler so
// it cannot rename or discard variables referenced only by these C blocks.
Porffor.c`
#include <errno.h>
#include <limits.h>
#include <sys/time.h>

static char *oxipng_cstr(jsval value) {
  u32 ptr = (u32)value.val;
  i32 len = *(i32*)(MEM + ptr);
  i32 type = porf_jv_type(value);
  char *out = malloc((size_t)len * 4 + 1);
  if (!out) { fputs("Out of memory\n", stderr); exit(1); }
  size_t used = 0;
  for (i32 i = 0; i < len; i++) {
    u32 cp = type == 195 ? (u8)MEM[ptr + 4 + i] : *(u16*)(MEM + ptr + 4 + i * 2);
    if (type == 195 || cp < 0x80) out[used++] = (char)cp;
    else {
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < len) {
        u32 lo = *(u16*)(MEM + ptr + 4 + (i + 1) * 2);
        if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + lo - 0xdc00; i++; }
      }
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
      if (cp < 0x800) { out[used++] = 0xc0 | (cp >> 6); out[used++] = 0x80 | (cp & 0x3f); }
      else if (cp < 0x10000) { out[used++] = 0xe0 | (cp >> 12); out[used++] = 0x80 | ((cp >> 6) & 0x3f); out[used++] = 0x80 | (cp & 0x3f); }
      else { out[used++] = 0xf0 | (cp >> 18); out[used++] = 0x80 | ((cp >> 12) & 0x3f); out[used++] = 0x80 | ((cp >> 6) & 0x3f); out[used++] = 0x80 | (cp & 0x3f); }
    }
  }
  out[used] = 0;
  return out;
}
`;

function pfDecodeUtf8(bytes: string): string {
  let escaped = '';
  for (let i = 0; i < bytes.length; i++) escaped += '%' + bytes.charCodeAt(i).toString(16).padStart(2, '0');
  return decodeURIComponent(escaped);
}

function pfArguments(): string[] {
  let pfCount = 0;
  Porffor.c`pfCount = porf_argc;`;
  const args: string[] = [];
  for (let i = 1; i < pfCount; i++) args.push(pfArgument(i));
  return args;
}

function pfArgument(pfArgIndex: number): string {
  let pfArgLength = 0;
  Porffor.c`pfArgLength = strlen(porf_argv[(i32)pfArgIndex.val]);`;
  const pfArgOut = Porffor.malloc(pfArgLength + 6);
  Porffor.c`
  u32 p = (u32)pfArgOut.val;
  *(i32*)(MEM + p) = (i32)pfArgLength;
  memcpy(MEM + p + 4, porf_argv[(i32)pfArgIndex.val], (size_t)pfArgLength);
  MEM[p + 4 + (i32)pfArgLength] = 0;
  `;
  return pfDecodeUtf8(Porffor.as<string>(pfArgOut, Porffor.TYPES.bytestring));
}

function pfExit(pfExitCode: number): void {
  Porffor.c`exit((int)pfExitCode.val);`;
}

function pfReadFileSync(pfInput: string | number): Uint8Array {
  let pfReadLength = -1;
  let pfReadBuffer = 0;
  Porffor.c`
  {
    char *path = NULL;
    FILE *file;
    if (porf_jv_type(pfInput) == 1 && pfInput.val == 0) file = stdin;
    else { path = oxipng_cstr(pfInput); file = fopen(path, "rb"); }
    if (file) {
      size_t used = 0, capacity = 8192;
      u8 *data = malloc(capacity);
      while (data) {
        size_t n = fread(data + used, 1, capacity - used, file);
        used += n;
        if (ferror(file)) { free(data); data = NULL; break; }
        if (feof(file)) break;
        if (capacity > INT_MAX / 2) { free(data); data = NULL; break; }
        capacity *= 2;
        u8 *next = realloc(data, capacity);
        if (!next) { free(data); data = NULL; break; }
        data = next;
      }
      if (data) { pfReadLength = (f64)used; pfReadBuffer = (f64)(uintptr_t)data; }
      if (file != stdin) fclose(file);
    }
    free(path);
  }
  `;
  if (pfReadLength < 0) throw new Error(`Could not read ${pfInput}`);
  const pfReadOut = new Uint8Array(pfReadLength);
  Porffor.c`
  {
    u32 p = (u32)pfReadOut.val;
    u32 data = *(u32*)(MEM + p + 4);
    memcpy(MEM + data + 4, (void*)(uintptr_t)pfReadBuffer, (size_t)pfReadLength);
    free((void*)(uintptr_t)pfReadBuffer);
  }
  `;
  return pfReadOut;
}

function pfWriteFileSync(pfOutput: string | number, pfData: string | Uint8Array): void {
  let pfWriteStatus = 0;
  Porffor.c`
  {
    char *path = NULL;
    FILE *file;
    int owned = porf_jv_type(pfOutput) != 1;
    if (owned) { path = oxipng_cstr(pfOutput); file = fopen(path, "wb"); }
    else file = pfOutput.val == 2 ? stderr : stdout;
    if (!file) pfWriteStatus = 1;
    else {
      u32 p = (u32)pfData.val;
      i32 type = porf_jv_type(pfData);
      if (type == 67 || type == 195) {
        char *text = oxipng_cstr(pfData);
        size_t len = strlen(text);
        if (fwrite(text, 1, len, file) != len) pfWriteStatus = 1;
        free(text);
      } else {
        i32 len = *(i32*)(MEM + p);
        u32 data = *(u32*)(MEM + p + 4);
        if (fwrite(MEM + data + 4, 1, (size_t)len, file) != (size_t)len) pfWriteStatus = 1;
      }
      if (owned ? fclose(file) != 0 : fflush(file) != 0) pfWriteStatus = 1;
    }
    free(path);
  }
  `;
  if (pfWriteStatus !== 0) throw new Error(`Could not write ${pfOutput}`);
}

function pfStatSync(pfStatPath: string) {
  let pfStatStatus = -1;
  let pfIsDirectory = 0;
  let pfMode = 0;
  let pfAtime = 0;
  let pfMtime = 0;
  Porffor.c`
  {
    char *path = oxipng_cstr(pfStatPath);
    struct stat st;
    pfStatStatus = stat(path, &st);
    if (pfStatStatus == 0) {
      pfIsDirectory = S_ISDIR(st.st_mode);
      pfMode = st.st_mode;
#ifdef __APPLE__
      pfAtime = st.st_atimespec.tv_sec * 1000.0 + st.st_atimespec.tv_nsec / 1e6;
      pfMtime = st.st_mtimespec.tv_sec * 1000.0 + st.st_mtimespec.tv_nsec / 1e6;
#else
      pfAtime = st.st_atim.tv_sec * 1000.0 + st.st_atim.tv_nsec / 1e6;
      pfMtime = st.st_mtim.tv_sec * 1000.0 + st.st_mtim.tv_nsec / 1e6;
#endif
    }
    free(path);
  }
  `;
  if (pfStatStatus !== 0) throw new Error(`Could not stat ${pfStatPath}`);
  const isDir = pfIsDirectory !== 0;
  return { isDirectory: () => isDir, mode: pfMode, atime: new Date(pfAtime), mtime: new Date(pfMtime) };
}

function pfExistsSync(path: string): boolean {
  try { pfStatSync(path); return true; } catch { return false; }
}

function pfMkdirSync(path: string, options?: { recursive?: boolean }): void {
  if (!options?.recursive) { pfMkdirOne(path); return; }
  let current = path.startsWith('/') ? '/' : '';
  for (const part of path.split('/')) {
    if (part === '') continue;
    current += (current !== '' && current !== '/' ? '/' : '') + part;
    pfMkdirOne(current);
  }
}

function pfMkdirOne(pfDirPath: string): void {
  let pfDirStatus = 0;
  Porffor.c`
  {
    char *path = oxipng_cstr(pfDirPath);
    struct stat st;
    if (mkdir(path, 0777) != 0 && !(errno == EEXIST && stat(path, &st) == 0 && S_ISDIR(st.st_mode))) pfDirStatus = 1;
    free(path);
  }
  `;
  if (pfDirStatus !== 0) throw new Error(`Could not create directory ${pfDirPath}`);
}

function pfReaddirSync(pfListPath: string): string[] {
  let pfListLength = -1;
  let pfListBuffer = 0;
  Porffor.c`
  {
    char *path = oxipng_cstr(pfListPath);
    DIR *dir = opendir(path);
    free(path);
    if (dir) {
      size_t used = 0, capacity = 8192;
      char *data = malloc(capacity);
      struct dirent *entry;
      errno = 0;
      while (data && (entry = readdir(dir))) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        size_t len = strlen(entry->d_name) + 1;
        if (used + len > capacity) {
          capacity = capacity * 2 + len;
          char *next = realloc(data, capacity);
          if (!next) { free(data); data = NULL; break; }
          data = next;
        }
        memcpy(data + used, entry->d_name, len);
        used += len;
      }
      if (errno && data) { free(data); data = NULL; }
      closedir(dir);
      if (data) { pfListLength = (f64)used; pfListBuffer = (f64)(uintptr_t)data; }
    }
  }
  `;
  if (pfListLength < 0) throw new Error(`Could not list ${pfListPath}`);
  const pfListOut = Porffor.malloc(pfListLength + 6);
  Porffor.c`
  {
    u32 p = (u32)pfListOut.val;
    *(i32*)(MEM + p) = (i32)pfListLength;
    memcpy(MEM + p + 4, (void*)(uintptr_t)pfListBuffer, (size_t)pfListLength);
    MEM[p + 4 + (i32)pfListLength] = 0;
    free((void*)(uintptr_t)pfListBuffer);
  }
  `;
  const bytes = Porffor.as<string>(pfListOut, Porffor.TYPES.bytestring);
  if (bytes.length === 0) return [];
  return bytes.slice(0, -1).split('\0').map(pfDecodeUtf8).sort();
}

function pfChmodSync(pfChmodPath: string, pfChmodMode: number): void {
  let pfChmodStatus = 0;
  Porffor.c`
  { char *path = oxipng_cstr(pfChmodPath); pfChmodStatus = chmod(path, (mode_t)pfChmodMode.val); free(path); }
  `;
  if (pfChmodStatus !== 0) throw new Error(`Could not chmod ${pfChmodPath}`);
}

function pfUtimesSync(path: string, atime: Date, mtime: Date): void {
  pfSetTimes(path, atime.getTime(), mtime.getTime());
}

function pfSetTimes(pfTimesPath: string, pfAtimeMs: number, pfMtimeMs: number): void {
  let pfTimesStatus = 0;
  Porffor.c`
  {
    char *path = oxipng_cstr(pfTimesPath);
    struct timeval times[2];
    times[0].tv_sec = (time_t)(pfAtimeMs.val / 1000);
    times[0].tv_usec = (suseconds_t)((pfAtimeMs.val - times[0].tv_sec * 1000.0) * 1000);
    times[1].tv_sec = (time_t)(pfMtimeMs.val / 1000);
    times[1].tv_usec = (suseconds_t)((pfMtimeMs.val - times[1].tv_sec * 1000.0) * 1000);
    pfTimesStatus = utimes(path, times);
    free(path);
  }
  `;
  if (pfTimesStatus !== 0) throw new Error(`Could not preserve timestamps on ${pfTimesPath}`);
}

function pfDirname(path: string): string {
  let end = path.length - 1;
  while (end > 0 && path[end] === '/') end--;
  const slash = path.lastIndexOf('/', end);
  return slash < 0 ? '.' : slash === 0 ? '/' : path.slice(0, slash);
}

const pfProcess = {
  stdout: { write: (data: string | Uint8Array) => pfWriteFileSync(1, data) },
  stderr: { write: (data: string | Uint8Array) => pfWriteFileSync(2, data) },
};

type PfOption = { type: 'string' | 'boolean'; short?: string; multiple?: boolean };
/** Strict subset of node:util.parseArgs used by buildOptionSpec(). */
function pfParseArgs(config: { args: string[]; options: Record<string, PfOption>; allowPositionals: boolean; strict: boolean }) {
  const values: Record<string, string | boolean | boolean[]> = {};
  const positionals: string[] = [];
  const args = config.args;
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (positionalOnly || arg === '-' || !arg.startsWith('-')) { positionals.push(arg); continue; }
    if (arg === '--') { positionalOnly = true; continue; }
    const long = arg.startsWith('--');
    const equal = long ? arg.indexOf('=') : -1;
    const letters = long ? [equal < 0 ? arg.slice(2) : arg.slice(2, equal)] : arg.slice(1).split('');
    for (let j = 0; j < letters.length; j++) {
      const letter = letters[j];
      let name = letter;
      if (!long) {
        name = '';
        for (const key of Object.keys(config.options)) if (config.options[key].short === letter) { name = key; break; }
      }
      if (!Object.hasOwn(config.options, name)) throw new Error(`Unknown option '${long ? '--' : '-'}${letter}'`);
      const spec = config.options[name];
      if (!spec || (spec.type !== 'boolean' && spec.type !== 'string')) throw new Error(`Unknown option '${long ? '--' : '-'}${letter}'`);
      if (spec.type === 'boolean') {
        if (equal >= 0) throw new Error(`Option --${name} does not take an argument`);
        if (spec.multiple) {
          const previous = values[name];
          values[name] = Array.isArray(previous) ? [...previous, true] : [true];
        } else values[name] = true;
      } else {
        let value: string;
        if (equal >= 0) value = arg.slice(equal + 1);
        else if (!long && j + 1 < letters.length) { value = letters.slice(j + 1).join(''); j = letters.length; }
        else {
          if (i + 1 >= args.length || args[i + 1].startsWith('-')) throw new Error(`Option --${name} requires an argument`);
          value = args[++i];
        }
        values[name] = value;
      }
    }
  }
  return { values, positionals };
}

function pfStringEndsWith(value: string, suffix: string, end = value.length): boolean {
  const stop = Math.min(value.length, Math.max(0, Number.isNaN(end) ? 0 : Math.trunc(end)));
  const start = stop - suffix.length;
  if (start < 0) return false;
  for (let i = 0; i < suffix.length; i++) if (value.charCodeAt(start + i) !== suffix.charCodeAt(i)) return false;
  return true;
}

/** Number of equal low bytes in a nonzero XOR of two little-endian words. */
function pfMatchingBytes(diff: number): number {
  if ((diff & 0xff) !== 0) return 0;
  if ((diff & 0xff00) !== 0) return 1;
  if ((diff & 0xff0000) !== 0) return 2;
  return 3;
}

/** Internal DEFLATE reader, NOT a general DataView replacement.
 * Callers supply integer offsets and never detach buffers. Alpha 17 stores the
 * effective buffer address (including byteOffset) at DataView + 4.
 * Bounds are checked before reading. Byte assembly permits unaligned reads and
 * gives little-endian results on either host endian; Clang folds it into a load.
 */
function pfCoreGetUint32LE(pfView: DataView, pfOffset: number): number {
  if (pfOffset < 0 || pfOffset + 4 > pfView.byteLength) throw new RangeError('DataView bounds');
  let pfWord = 0;
  Porffor.c`
  u32 view_ptr = (u32)pfView.val;
  u32 data_ptr = *(u32*)(MEM + view_ptr + 4);
  const u8 *bytes = (const u8*)(MEM + data_ptr + 4 + (u32)pfOffset.val);
  pfWord = (f64)((u32)bytes[0] | ((u32)bytes[1] << 8) | ((u32)bytes[2] << 16) | ((u32)bytes[3] << 24));
  `;
  return pfWord;
}
