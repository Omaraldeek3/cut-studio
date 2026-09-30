/*
 * Minimal stand-in for ICU's utf8.h -- see utypes.h for rationale.
 *
 * U8_APPEND_UNSAFE is derived from ICU's utf8.h. It is distributed under the
 * ICU 1.8.1-57.1 licence; see native/shim/NOTICE.
 */
#ifndef CDRWASM_SHIM_UTF8_H
#define CDRWASM_SHIM_UTF8_H

#include <unicode/utypes.h>

#define U8_MAX_LENGTH 4

/* Encode one code point as UTF-8 at s[i], advancing i. Mirrors ICU's macro. */
#define U8_APPEND_UNSAFE(s, i, c)                                            \
  do {                                                                       \
    uint32_t _u8c = (uint32_t)(c);                                           \
    if (_u8c <= 0x7f) {                                                      \
      (s)[(i)++] = (uint8_t)_u8c;                                            \
    } else if (_u8c <= 0x7ff) {                                              \
      (s)[(i)++] = (uint8_t)((_u8c >> 6) | 0xc0);                            \
      (s)[(i)++] = (uint8_t)((_u8c & 0x3f) | 0x80);                          \
    } else if (_u8c <= 0xffff) {                                             \
      (s)[(i)++] = (uint8_t)((_u8c >> 12) | 0xe0);                           \
      (s)[(i)++] = (uint8_t)(((_u8c >> 6) & 0x3f) | 0x80);                   \
      (s)[(i)++] = (uint8_t)((_u8c & 0x3f) | 0x80);                          \
    } else {                                                                 \
      (s)[(i)++] = (uint8_t)((_u8c >> 18) | 0xf0);                           \
      (s)[(i)++] = (uint8_t)(((_u8c >> 12) & 0x3f) | 0x80);                  \
      (s)[(i)++] = (uint8_t)(((_u8c >> 6) & 0x3f) | 0x80);                   \
      (s)[(i)++] = (uint8_t)((_u8c & 0x3f) | 0x80);                          \
    }                                                                        \
  } while (0)

#endif
