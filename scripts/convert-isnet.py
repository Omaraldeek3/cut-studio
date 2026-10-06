"""Prepare IS-Net for the browser: the background remover's model.

The model is IS-Net "general use" from DIS, Highly Accurate Dichotomous Image
Segmentation (Xuebin Qin et al., https://github.com/xuebinqin/DIS,
Apache-2.0), in the ONNX form rembg publishes:

    https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
    sha256 60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a

This script keeps only the finest of its outputs (the mask the remover uses),
stores the weights as float16 with float32 input and output, checks the result
against the original on a random image, and cuts the file into parts small
enough for any static host. The browser joins the parts again.

    pip install onnx onnxconverter-common onnxruntime numpy
    python scripts/convert-isnet.py isnet-general-use.onnx

Writes public/models/isnet/isnet-fp16.onnx.part0 to part4.
"""

import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxconverter_common import float16

PART = 18 * 1024 * 1024
out = Path(__file__).resolve().parent.parent / 'public' / 'models' / 'isnet'

model = onnx.load(sys.argv[1])
name, finest = model.graph.input[0].name, model.graph.output[0].name
model = onnx.utils.Extractor(model).extract_model([name], [finest])
# Resize stays in float16 too, so no float32 tensor reaches a float16 convolution.
block = [op for op in float16.DEFAULT_OP_BLOCK_LIST if op not in ('Resize', 'Upsample')]
half = float16.convert_float_to_float16(model, keep_io_types=True, op_block_list=block)

x = np.random.RandomState(0).rand(1, 3, 1024, 1024).astype(np.float32) - 0.5
a = ort.InferenceSession(model.SerializeToString()).run(None, {name: x})[0]
b = ort.InferenceSession(half.SerializeToString()).run(None, {name: x})[0]
diff = float(np.abs(a - b).max())
assert diff < 1e-2, f'float16 drifts from the original by {diff}'
print(f'float16 matches the original within {diff:.5f}')

data = half.SerializeToString()
out.mkdir(parents=True, exist_ok=True)
for old in out.glob('isnet-fp16.onnx.part*'):
    old.unlink()
for i in range(0, len(data), PART):
    (out / f'isnet-fp16.onnx.part{i // PART}').write_bytes(data[i:i + PART])
print(f'{len(data)} bytes in {-(-len(data) // PART)} parts')
