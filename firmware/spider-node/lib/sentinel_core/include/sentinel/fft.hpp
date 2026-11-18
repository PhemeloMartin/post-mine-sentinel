#pragma once
#include <cstddef>

namespace sentinel {

/// In-place iterative radix-2 Cooley–Tukey FFT in double precision (parity with NumPy's
/// pocketfft for the golden-vector tests). n must be a power of two (2048 for a 4 s window).
/// Twiddle factors are computed once per size and cached.
class Fft {
public:
    static constexpr std::size_t kMaxN = 2048;
    /// re/im: length n. Returns false if n is not a supported power of two.
    static bool forward(double* re, double* im, std::size_t n);
};

}  // namespace sentinel
