# Third-party notices

Cut Studio's own code is MIT licensed (see `LICENSE`). It uses and ships the
following work by others, each under its own licence.

| Component | Used for | Licence |
| --- | --- | --- |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) model weights (`realesr-general-x4v3`, `realesr-general-wdn-x4v3`, `realesr-animevideov3`), converted to ONNX | AI upscaler | BSD 3-Clause, copyright Xintao Wang; the licence text ships in `public/models/realesrgan/LICENSE.txt` |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | Running the upscaler model in the browser | MIT |
| [HarfBuzz](https://github.com/harfbuzz/harfbuzz) via [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | Shaping Arabic and Latin text into glyphs | MIT (harfbuzzjs), Old MIT (HarfBuzz) |
| [Tajawal](https://fonts.google.com/specimen/Tajawal) via Fontsource | Built-in lettering font and interface font | SIL Open Font License 1.1 |
| [Manrope](https://github.com/sharanda/manrope) via Fontsource | Interface font | SIL Open Font License 1.1 |
| [Clipper2](https://github.com/AngusJohnson/Clipper2) via [@countertype/clipper2-ts](https://github.com/countertype/clipper2-ts) | Welding letters and offsetting outlines | Boost Software License 1.0 |
| [three.js](https://threejs.org) | 3D views of boxes and gears | MIT |
| [Next.js](https://nextjs.org) and [React](https://react.dev) | The application | MIT |
| [libcdr](https://wiki.documentfoundation.org/DLP/Libraries/libcdr) 0.1.9 and [librevenge](https://sourceforge.net/p/libwpd/librevenge/) 0.0.6, compiled with its `cdr2xhtml` converter to `public/wasm/cdr2xhtml.wasm` | Reading CorelDRAW files in the browser | MPL 2.0 (see below) |
| [Little CMS](https://www.littlecms.com) 2.12 and [zlib](https://zlib.net) 1.3.1, in the same module | Colour management and decompression inside libcdr | MIT, zlib License |
| ICU compatibility headers from [go-libcdr](https://github.com/nobbs/go-libcdr), in `native/cdr/shim` | Letting libcdr build without the full ICU library | MIT, copyright Alexej Disterhoft; the ICU-derived macro keeps its notice in `native/cdr/shim/NOTICE` |

## CorelDRAW reader source code

`public/wasm/cdr2xhtml.wasm` contains libcdr and librevenge in executable form.
Under the Mozilla Public License 2.0, their source code is available from:

- libcdr 0.1.9: https://dev-www.libreoffice.org/src/libcdr/libcdr-0.1.9.tar.xz
- librevenge 0.0.6: https://dev-www.libreoffice.org/src/librevenge-0.0.6.tar.bz2

No file of either project is modified. `native/cdr/build.sh` downloads exactly
these archives (checked by SHA-256) and rebuilds the module from them.
CorelDRAW is a trademark of Corel Corporation; Cut Studio is not affiliated with Corel.
