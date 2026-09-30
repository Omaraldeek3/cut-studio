/*
 * Implementation of the ICU subset libcdr needs. See shim/unicode/utypes.h.
 *
 * Two converters are decoded faithfully:
 *   UTF-16LE      - how CDR stores modern text runs, including surrogate pairs
 *   windows-1252  - libcdr's default single-byte fallback
 * Every other requested codepage falls back to windows-1252.
 */

#include <unicode/ucnv.h>
#include <unicode/ucsdet.h>

#include <cstring>
#include <new>

namespace
{

enum Encoding
{
  ENCODING_CP1252,
  ENCODING_UTF16LE
};

/* windows-1252 differs from Latin-1 only in 0x80..0x9f. */
const UChar32 CP1252_HIGH[32] =
{
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
};

} // namespace

struct UConverter
{
  Encoding encoding;
};

extern "C" {

UConverter *ucnv_open(const char *converterName, UErrorCode *err)
{
  if (err && U_FAILURE(*err))
    return nullptr;
  auto *converter = new (std::nothrow) UConverter();
  if (!converter)
  {
    if (err)
      *err = U_MEMORY_ALLOCATION_ERROR;
    return nullptr;
  }
  converter->encoding =
    (converterName && std::strcmp(converterName, "UTF-16LE") == 0)
    ? ENCODING_UTF16LE : ENCODING_CP1252;
  if (err)
    *err = U_ZERO_ERROR;
  return converter;
}

void ucnv_close(UConverter *converter)
{
  delete converter;
}

UChar32 ucnv_getNextUChar(UConverter *converter, const char **source,
                          const char *sourceLimit, UErrorCode *err)
{
  if (!converter || !source || !*source || *source >= sourceLimit)
  {
    if (err)
      *err = U_INVALID_CHAR_FOUND;
    return 0xffff;
  }
  const auto *bytes = reinterpret_cast<const unsigned char *>(*source);
  if (err)
    *err = U_ZERO_ERROR;

  if (converter->encoding == ENCODING_CP1252)
  {
    const unsigned char byte = bytes[0];
    *source += 1;
    return (byte >= 0x80 && byte <= 0x9f) ? CP1252_HIGH[byte - 0x80] : (UChar32)byte;
  }

  /* UTF-16LE, combining surrogate pairs where present. */
  if (sourceLimit - *source < 2)
  {
    *source = sourceLimit;
    if (err)
      *err = U_INVALID_CHAR_FOUND;
    return 0xffff;
  }
  const uint32_t lead = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8);
  *source += 2;
  if (lead >= 0xd800 && lead <= 0xdbff && sourceLimit - *source >= 2)
  {
    const auto *next = reinterpret_cast<const unsigned char *>(*source);
    const uint32_t trail = (uint32_t)next[0] | ((uint32_t)next[1] << 8);
    if (trail >= 0xdc00 && trail <= 0xdfff)
    {
      *source += 2;
      return (UChar32)(0x10000 + ((lead - 0xd800) << 10) + (trail - 0xdc00));
    }
  }
  return (UChar32)lead;
}

/* Charset detection is deliberately unimplemented: reporting failure makes
   libcdr's getEncoding() return 0, selecting its windows-1252 default. */
UCharsetDetector *ucsdet_open(UErrorCode *status)
{
  if (status)
    *status = U_UNSUPPORTED_ERROR;
  return nullptr;
}

void ucsdet_close(UCharsetDetector *) {}

void ucsdet_setText(UCharsetDetector *, const char *, int32_t, UErrorCode *status)
{
  if (status)
    *status = U_ZERO_ERROR;
}

bool ucsdet_enableInputFilter(UCharsetDetector *, bool) { return false; }

const UCharsetMatch *ucsdet_detect(UCharsetDetector *, UErrorCode *status)
{
  if (status)
    *status = U_UNSUPPORTED_ERROR;
  return nullptr;
}

const char *ucsdet_getName(const UCharsetMatch *, UErrorCode *status)
{
  if (status)
    *status = U_UNSUPPORTED_ERROR;
  return nullptr;
}

int32_t ucsdet_getConfidence(const UCharsetMatch *, UErrorCode *status)
{
  if (status)
    *status = U_UNSUPPORTED_ERROR;
  return 0;
}

} // extern "C"
