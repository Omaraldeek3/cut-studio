#!/bin/sh
# Builds public/wasm/cdr2xhtml.wasm: libcdr's own cdr2xhtml converter compiled
# to WebAssembly (wasm32-wasip1), so CorelDRAW files are read in the browser
# and never leave the visitor's computer.
#
# Runs on Linux (or WSL). Every download is pinned by its SHA-256, so the same
# sources always give the same module. Nothing is installed system-wide: the
# toolchain and sources go into $CACHE.
#
#   sh native/cdr/build.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
CACHE=${CUT_STUDIO_CDR_CACHE:-$HOME/.cache/cut-studio-cdr}
OBJ=$CACHE/obj
TARGET=wasm32-wasip1
mkdir -p "$CACHE"
cd "$CACHE"

fetch() {
  url=$1 archive=$2 directory=$3 checksum=$4
  [ -d "$directory" ] && return
  echo "==> fetching $directory"
  curl -fsSL --retry 5 --retry-delay 3 "$url" -o "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
  mkdir -p "$directory"
  tar xf "$archive" -C "$directory" --strip-components=1
  rm -f "$archive"
}

# Toolchain.
fetch https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz \
  wasi-sdk.tar.gz wasi-sdk 0ba8b5bfaeb2adf3f29bab5841d76cf5318ab8e1642ea195f88baba1abd47bce
fetch https://github.com/WebAssembly/binaryen/releases/download/version_131/binaryen-version_131-x86_64-linux.tar.gz \
  binaryen.tar.gz binaryen b5bf1f0eaf17c63ee588ff7a5954dc8f6ce2c26989051c66f24dfe9ece3e46db
# libcdr and librevenge only use Boost's headers.
fetch https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.bz2 \
  boost.tar.bz2 boost 6478edfe2f3305127cffe8caf73ea0176c53769f4bf1585be237eb30798c3b8e

# Sources, unmodified.
fetch https://dev-www.libreoffice.org/src/libcdr/libcdr-0.1.9.tar.xz \
  libcdr.tar.xz libcdr f7bb6abdd7f226820f288a93dd8d07759833c0250d9e202af90f9b312c4665a3
fetch https://dev-www.libreoffice.org/src/librevenge-0.0.6.tar.bz2 \
  librevenge.tar.bz2 librevenge 52a65e904d255dbdd97a8b7bb28d6574e14f999eb01416aff004502406d0904d
fetch https://dev-www.libreoffice.org/src/lcms2-2.12.tar.gz \
  lcms2.tar.gz lcms2 18663985e864100455ac3e507625c438c3710354d85e5cbb7cd4043e11fe10f5
fetch https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz \
  zlib.tar.gz zlib 9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23

CC=$CACHE/wasi-sdk/bin/clang
CXX=$CACHE/wasi-sdk/bin/clang++
SYSROOT=$CACHE/wasi-sdk/share/wasi-sysroot

# The ICU headers are shadowed by a small shim: libcdr only uses ICU to decode
# text runs, and the workshop tools drop text anyway (it must be converted to
# curves before cutting). See shim/unicode/utypes.h.
INCLUDES="-I$HERE/shim -I$CACHE/boost \
-I$CACHE/librevenge/inc -I$CACHE/librevenge/src/lib \
-I$CACHE/libcdr/inc -I$CACHE/libcdr/src/lib \
-I$CACHE/lcms2/include -I$CACHE/zlib"
# lcms2 uses `register` in its headers. RTTI and exceptions are needed by
# librevenge and libcdr.
CXXFLAGS="--target=$TARGET --sysroot=$SYSROOT -O2 -fwasm-exceptions -std=c++17 -DNDEBUG \
-DVERSION=\"0.1.9\" -Wno-deprecated-builtins -Wno-deprecated-declarations -Wno-register $INCLUDES"
CFLAGS="--target=$TARGET --sysroot=$SYSROOT -O2 -DNDEBUG -Wno-register $INCLUDES"

rm -rf "$OBJ"
mkdir -p "$OBJ"
compile_c() { for file in "$@"; do "$CC" $CFLAGS -c "$file" -o "$OBJ/$(echo "$file" | tr '/' '_').o"; done; }
compile_cxx() { for file in "$@"; do "$CXX" $CXXFLAGS -c "$file" -o "$OBJ/$(echo "$file" | tr '/' '_').o"; done; }

echo "==> zlib"
compile_c zlib/adler32.c zlib/crc32.c zlib/inffast.c zlib/inflate.c zlib/inftrees.c zlib/zutil.c zlib/uncompr.c
echo "==> lcms2"
compile_c lcms2/src/*.c
echo "==> librevenge"
compile_cxx librevenge/src/lib/*.cpp
echo "==> libcdr"
compile_cxx libcdr/src/lib/*.cpp
echo "==> ICU shim and cdr2xhtml"
compile_cxx "$HERE"/shim/icu_shim.cpp libcdr/src/conv/svg/cdr2xhtml.cpp

echo "==> link"
"$CXX" --target=$TARGET --sysroot=$SYSROOT -O2 -fwasm-exceptions -L"$SYSROOT/lib/$TARGET/eh" -lunwind \
  -o "$CACHE/cdr2xhtml.raw.wasm" "$OBJ"/*.o

# wasi-sdk's own libraries use the standard (exnref) exception instructions
# and our code the legacy ones. Browsers refuse a module that mixes them, so
# everything is translated to exnref (Chrome 137, Firefox 131, Safari 18.4 and later).
echo "==> optimise"
mkdir -p "$ROOT/public/wasm"
"$CACHE"/binaryen/bin/wasm-opt --enable-exception-handling --enable-bulk-memory --translate-to-exnref \
  --strip-debug --strip-producers -O2 "$CACHE/cdr2xhtml.raw.wasm" -o "$ROOT/public/wasm/cdr2xhtml.wasm"
rm -f "$CACHE/cdr2xhtml.raw.wasm"
ls -l "$ROOT/public/wasm/cdr2xhtml.wasm"
sha256sum "$ROOT/public/wasm/cdr2xhtml.wasm"
