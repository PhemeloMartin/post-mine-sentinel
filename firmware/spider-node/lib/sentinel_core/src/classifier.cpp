#include "sentinel/classifier.hpp"

#include <algorithm>
#include <cmath>

namespace sentinel {

static_assert(model::kNumFeatures == static_cast<int>(kNumFeatures), "model/feature count mismatch: re-export the model");

Classification classify(const FeatureVector& features) {
    float z[model::kNumFeatures];
    for (int i = 0; i < model::kNumFeatures; ++i) {
        const float scale = model::kFeatureScale[i] == 0.0f ? 1.0f : model::kFeatureScale[i];
        z[i] = (features[i] - model::kFeatureMean[i]) / scale;
    }
    float h1[model::kHidden1];
    for (int j = 0; j < model::kHidden1; ++j) {
        float acc = model::kB1[j];
        for (int i = 0; i < model::kNumFeatures; ++i) acc += z[i] * model::kW1[i][j];
        h1[j] = std::max(0.0f, acc);
    }
    float h2[model::kHidden2];
    for (int j = 0; j < model::kHidden2; ++j) {
        float acc = model::kB2[j];
        for (int i = 0; i < model::kHidden1; ++i) acc += h1[i] * model::kW2[i][j];
        h2[j] = std::max(0.0f, acc);
    }
    float logits[model::kNumClasses];
    float maxLogit = -1e30f;
    for (int j = 0; j < model::kNumClasses; ++j) {
        float acc = model::kB3[j];
        for (int i = 0; i < model::kHidden2; ++i) acc += h2[i] * model::kW3[i][j];
        logits[j] = acc;
        maxLogit = std::max(maxLogit, acc);
    }
    Classification out;
    float sum = 0.0f;
    for (int j = 0; j < model::kNumClasses; ++j) {
        out.proba[j] = std::exp(logits[j] - maxLogit);  // numerically stable softmax
        sum += out.proba[j];
    }
    for (int j = 0; j < model::kNumClasses; ++j) {
        out.proba[j] /= sum;
        if (model::kIsThreat[j]) out.pThreat += out.proba[j];
        if (out.proba[j] > out.proba[out.label]) out.label = j;
    }
    out.alarm = out.pThreat >= model::kAlarmThreshold;
    return out;
}

}  // namespace sentinel
