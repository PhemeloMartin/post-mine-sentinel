#include "sentinel/fft.hpp"

#include <cmath>
#include <utility>

namespace sentinel {
namespace {

constexpr double kPi = 3.14159265358979323846;
double gCos[Fft::kMaxN / 2];
double gSin[Fft::kMaxN / 2];
std::size_t gTwiddleN = 0;

void buildTwiddles(std::size_t n) {
    for (std::size_t k = 0; k < n / 2; ++k) {
        const double a = -2.0 * kPi * static_cast<double>(k) / static_cast<double>(n);
        gCos[k] = std::cos(a);
        gSin[k] = std::sin(a);
    }
    gTwiddleN = n;
}

}  // namespace

bool Fft::forward(double* re, double* im, std::size_t n) {
    if (n < 2 || n > kMaxN || (n & (n - 1)) != 0) return false;
    if (gTwiddleN != n) buildTwiddles(n);

    // Bit-reversal permutation.
    for (std::size_t i = 1, j = 0; i < n; ++i) {
        std::size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            std::swap(re[i], re[j]);
            std::swap(im[i], im[j]);
        }
    }
    // Butterflies.
    for (std::size_t len = 2; len <= n; len <<= 1) {
        const std::size_t half = len / 2;
        const std::size_t step = n / len;
        for (std::size_t start = 0; start < n; start += len) {
            for (std::size_t k = 0; k < half; ++k) {
                const double wr = gCos[k * step];
                const double wi = gSin[k * step];
                const std::size_t a = start + k;
                const std::size_t b = a + half;
                const double tr = re[b] * wr - im[b] * wi;
                const double ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
    return true;
}

}  // namespace sentinel
