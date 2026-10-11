#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

// ScriptC FFI strings are length-delimited UTF-8, not NUL-terminated.
int32_t oxipng_scriptc_mode(const uint8_t *bytes, size_t length) {
  if (length == SIZE_MAX || (length && memchr(bytes, 0, length))) return -1;
  char *path = malloc(length + 1);
  if (!path) return -1;
  if (length) memcpy(path, bytes, length);
  path[length] = 0;
  struct stat value;
  int status = stat(path, &value);
  free(path);
  return status == 0 ? (int32_t)value.st_mode : -1;
}
