/*
 * Minimal stand-in for ICU's utypes.h.
 *
 * libcdr uses ICU in exactly one translation unit (src/lib/libcdr_utils.cpp)
 * and only to transcode text runs from legacy CorelDRAW codepages. Vector
 * geometry, colours and layers never touch it. Building real ICU for
 * wasm32-wasi costs tens of megabytes of locale data for a code path that
 * laser cutting files almost never exercise, so these headers shadow ICU and
 * libcdr compiles unmodified against them.
 *
 * Limitation: only UTF-16LE and windows-1252 are decoded faithfully. Other
 * legacy codepages fall back to windows-1252, so non-Latin text runs may be
 * transcoded incorrectly. Nothing else in the output is affected.
 */
#ifndef CDRWASM_SHIM_UTYPES_H
#define CDRWASM_SHIM_UTYPES_H

#include <stdint.h>

typedef int32_t UChar32;
typedef uint16_t UChar;

typedef enum UErrorCode
{
  U_ZERO_ERROR = 0,
  U_ILLEGAL_ARGUMENT_ERROR = 1,
  U_MEMORY_ALLOCATION_ERROR = 7,
  U_INVALID_CHAR_FOUND = 10,
  U_UNSUPPORTED_ERROR = 16
} UErrorCode;

#define U_SUCCESS(x) ((x) <= U_ZERO_ERROR)
#define U_FAILURE(x) ((x) > U_ZERO_ERROR)

/* Valid Unicode scalar value: in range, not a surrogate, not a noncharacter. */
#define U_IS_UNICODE_CHAR(c) \
  ((uint32_t)(c) <= 0x10ffff && \
   !((uint32_t)(c) >= 0xd800 && (uint32_t)(c) <= 0xdfff) && \
   !(((uint32_t)(c) & 0xfffe) == 0xfffe) && \
   !((uint32_t)(c) >= 0xfdd0 && (uint32_t)(c) <= 0xfdef))

#endif
