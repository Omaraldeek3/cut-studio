/* Minimal stand-in for ICU's ucnv.h -- see utypes.h for rationale. */
#ifndef CDRWASM_SHIM_UCNV_H
#define CDRWASM_SHIM_UCNV_H

#include <unicode/utypes.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct UConverter UConverter;

UConverter *ucnv_open(const char *converterName, UErrorCode *err);
void ucnv_close(UConverter *converter);
UChar32 ucnv_getNextUChar(UConverter *converter, const char **source,
                          const char *sourceLimit, UErrorCode *err);

#ifdef __cplusplus
}
#endif
#endif
