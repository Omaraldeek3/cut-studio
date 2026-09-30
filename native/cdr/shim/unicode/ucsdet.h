/* Minimal stand-in for ICU's ucsdet.h -- see utypes.h for rationale.
   Charset auto-detection is not implemented: ucsdet_detect always reports
   failure, so libcdr falls back to its default (windows-1252) code path. */
#ifndef CDRWASM_SHIM_UCSDET_H
#define CDRWASM_SHIM_UCSDET_H

#include <unicode/utypes.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct UCharsetDetector UCharsetDetector;
typedef struct UCharsetMatch UCharsetMatch;

UCharsetDetector *ucsdet_open(UErrorCode *status);
void ucsdet_close(UCharsetDetector *ucsd);
void ucsdet_setText(UCharsetDetector *ucsd, const char *textIn, int32_t len,
                    UErrorCode *status);
bool ucsdet_enableInputFilter(UCharsetDetector *ucsd, bool filter);
const UCharsetMatch *ucsdet_detect(UCharsetDetector *ucsd, UErrorCode *status);
const char *ucsdet_getName(const UCharsetMatch *ucsm, UErrorCode *status);
int32_t ucsdet_getConfidence(const UCharsetMatch *ucsm, UErrorCode *status);

#ifdef __cplusplus
}
#endif
#endif
