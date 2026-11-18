#pragma once
// On-device MLP inference using the weights exported by ml/sentinel_ml/edge/export.py.
// 21 → 32 → 16 → 7, ReLU, softmax. ≈1.3 k multiply-accumulates per 4 s window.
#include <array>

#include "sentinel/features.hpp"
#include "sentinel/model_weights.h"

namespace sentinel {

struct Classification {
    std::array<float, model::kNumClasses> proba{};
    int label = 0;
    float pThreat = 0.0f;   // Σ P(threat classes)
    bool alarm = false;     // pThreat ≥ model::kAlarmThreshold
};

Classification classify(const FeatureVector& features);

}  // namespace sentinel
