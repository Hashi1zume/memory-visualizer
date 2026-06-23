import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from python_tracer import summarize_value


def test_function_with_shape_attribute_is_not_matrix():
    def sample():
        return None

    sample.shape = sample
    sample.dtype = "fake"

    summary = summarize_value(sample)

    assert summary["kind"] == "object"
    assert summary["summary"] == "function"


def test_iterable_shape_is_matrix():
    class FakeArray:
        shape = (2, 3)
        dtype = "float32"

    summary = summarize_value(FakeArray())

    assert summary["kind"] == "matrix"
    assert summary["shape"] == [2, 3]


if __name__ == "__main__":
    test_function_with_shape_attribute_is_not_matrix()
    test_iterable_shape_is_matrix()
    print("Python tracer tests passed")
