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
| [libcdr](https://wiki.documentfoundation.org/DLP/Libraries/libcdr) (`cdr2xhtml`), set up locally by `scripts/setup-cdr-runtime.py` | Reading CorelDRAW files on your own computer; not part of the website | MPL 2.0 |
