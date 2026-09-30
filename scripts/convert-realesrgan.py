"""Convert the official Real-ESRGAN compact weights into ONNX models for the
browser, without installing PyTorch.

The three checkpoints come from the Real-ESRGAN v0.2.5.0 release
(https://github.com/xinntao/Real-ESRGAN, BSD-3-Clause):

    realesr-general-x4v3.pth       photos
    realesr-general-wdn-x4v3.pth   photos with heavy JPEG noise
    realesr-animevideov3.pth       flat graphics, logos, cartoons

All three are SRVGGNetCompact: a 3x3 convolution and PReLU, repeated, then a
pixel shuffle to 4x, added to a nearest-neighbour 4x copy of the input. That
graph is small enough to write out by hand with the onnx helpers, which is
what this script does. Weights are stored as float16 to halve the download
and cast back to float32 inside the graph.

    python scripts/convert-realesrgan.py <folder with the .pth files> [probe folder]

Writes public/models/realesrgan/*.onnx. With a probe folder it also writes a
random test image and each model's numpy forward pass on it, so the browser
runtime can be checked against a reference that does not share its code.
"""

import collections
import pickle
import sys
import zipfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

MODELS = {
    "realesr-general-x4v3": ("general-x4v3", 32),
    "realesr-general-wdn-x4v3": ("general-wdn-x4v3", 32),
    "realesr-animevideov3": ("animevideo-x4v3", 16),
}
FEATURES, SCALE = 64, 4
DTYPES = {"FloatStorage": np.float32, "HalfStorage": np.float16, "DoubleStorage": np.float64}


class _Storage:
    def __init__(self, name):
        self.name = name


def load_checkpoint(path: Path):
    """Read a zip-format torch checkpoint into numpy arrays."""
    archive = zipfile.ZipFile(path)
    prefix = archive.namelist()[0].split("/")[0]

    def rebuild(storage, offset, size, stride, *_):
        count = int(np.prod(size)) if size else 1
        flat = storage[offset:]
        if not size:
            return flat[:1].copy().reshape(())
        strides = [s * flat.itemsize for s in stride]
        return np.lib.stride_tricks.as_strided(flat, shape=size, strides=strides).copy() if count else np.zeros(size, flat.dtype)

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return rebuild
            if module == "torch" and name.endswith("Storage"):
                return _Storage(name)
            if module == "collections" and name == "OrderedDict":
                return collections.OrderedDict
            raise pickle.UnpicklingError(f"refusing to load {module}.{name}")

        def persistent_load(self, pid):
            _, storage, key, _location, _numel = pid
            data = archive.read(f"{prefix}/data/{key}")
            return np.frombuffer(data, dtype=DTYPES[storage.name])

    with archive.open(f"{prefix}/data.pkl") as handle:
        state = Unpickler(handle).load()
    params = state.get("params_ema") or state.get("params") or state
    return {key: np.asarray(value, dtype=np.float32) for key, value in params.items()}


def layers(weights, convs):
    """(conv weight, conv bias, prelu slope or None) for every stage, in order."""
    stages = []
    for index in range(convs + 1):
        conv = 2 * index
        stages.append((weights[f"body.{conv}.weight"], weights[f"body.{conv}.bias"], weights[f"body.{conv + 1}.weight"]))
    last = 2 * (convs + 1)
    stages.append((weights[f"body.{last}.weight"], weights[f"body.{last}.bias"], None))
    return stages


def build(stages, name):
    nodes, inits = [], []

    def const(value, label):
        half = numpy_helper.from_array(value.astype(np.float16), f"{label}_h")
        inits.append(half)
        nodes.append(helper.make_node("Cast", [f"{label}_h"], [label], to=TensorProto.FLOAT))
        return label

    current = "input"
    for i, (weight, bias, slope) in enumerate(stages):
        w, b = const(weight, f"w{i}"), const(bias, f"b{i}")
        out = f"conv{i}"
        nodes.append(helper.make_node("Conv", [current, w, b], [out], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
        current = out
        if slope is not None:
            s = const(slope.reshape(-1, 1, 1), f"a{i}")
            act = f"act{i}"
            nodes.append(helper.make_node("PRelu", [current, s], [act]))
            current = act
    nodes.append(helper.make_node("DepthToSpace", [current], ["shuffled"], blocksize=SCALE, mode="CRD"))
    inits.append(numpy_helper.from_array(np.array([1, 1, SCALE, SCALE], dtype=np.float32), "scales"))
    nodes.append(helper.make_node("Resize", ["input", "", "scales"], ["base"], mode="nearest",
                                  coordinate_transformation_mode="asymmetric", nearest_mode="floor"))
    nodes.append(helper.make_node("Add", ["shuffled", "base"], ["output"]))
    graph = helper.make_graph(
        nodes, name,
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, "h", "w"])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "H", "W"])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="cut-studio")
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


def reference(stages, image):
    """A plain numpy forward pass, for checking the graph."""
    x = image
    for weight, bias, slope in stages:
        padded = np.pad(x, ((0, 0), (1, 1), (1, 1)))
        h, w = x.shape[1:]
        out = np.zeros((weight.shape[0], h, w), np.float32)
        for dy in range(3):
            for dx in range(3):
                out += np.einsum("oi,ihw->ohw", weight[:, :, dy, dx], padded[:, dy:dy + h, dx:dx + w])
        out += bias[:, None, None]
        if slope is not None:
            out = np.where(out >= 0, out, out * slope[:, None, None])
        x = out
    c, h, w = x.shape
    shuffled = x.reshape(3, SCALE, SCALE, h, w).transpose(0, 3, 1, 4, 2).reshape(3, h * SCALE, w * SCALE)
    return shuffled + image.repeat(SCALE, axis=1).repeat(SCALE, axis=2)


def main(folder: Path, probes: Path | None):
    target = Path(__file__).resolve().parent.parent / "public" / "models" / "realesrgan"
    target.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    probe = rng.random((3, 12, 10), dtype=np.float32)
    if probes:
        probes.mkdir(parents=True, exist_ok=True)
        (probes / "probe-input.bin").write_bytes(probe.tobytes())
    for source, (name, convs) in MODELS.items():
        weights = load_checkpoint(folder / f"{source}.pth")
        stages = layers(weights, convs)
        assert stages[0][0].shape == (FEATURES, 3, 3, 3), stages[0][0].shape
        assert stages[-1][0].shape == (3 * SCALE * SCALE, FEATURES, 3, 3), stages[-1][0].shape
        model = build(stages, name)
        # The stored weights are float16, so the reference uses the same rounding.
        rounded = [(w.astype(np.float16).astype(np.float32), b.astype(np.float16).astype(np.float32),
                    None if a is None else a.astype(np.float16).astype(np.float32)) for w, b, a in stages]
        path = target / f"{name}.onnx"
        onnx.save(model, path)
        if probes:
            expected = reference(rounded, probe)
            (probes / f"{name}.expected.bin").write_bytes(expected.astype(np.float32).tobytes())
        print(f"{name}: {len(stages)} convolutions, {path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
