#pragma once
// C++ mirror of ml/sentinel_ml/features/seismic.py (the specification). Parity is enforced by
// golden vectors exported from the Python pipeline (test/golden/golden_vectors.h).
#include <array>
#include <cstddef>
#include <cstdint>

#include "sentinel/status.hpp"

namespace sentinel {

constexpr std::size_t kWindow = 2000;      // 4 s at 500 Hz
constexpr std::size_t kNumFeatures = 21;
constexpr float kSampleRateHz = 500.0f;

using FeatureVector = std::array<float, kNumFeatures>;

/// Scratch memory for one extraction (~66 KB). Allocate statically, never on a task stack.
struct FeatureWorkspace {
    float x[kWindow];
    double re[2048];
    double im[2048];
    double cum[kWindow + 1];
    float env[kWindow / 5];
    float sorted[kWindow / 5];
    float dev[kWindow / 5];
    int peaks[kWindow / 5];
};

/// Extract the 21 features from one window of int16 ADC counts.
[[nodiscard]] Status extractFeatures(const int16_t* samples, std::size_t n, FeatureVector& out, FeatureWorkspace& ws);

}  // namespace sentinel
