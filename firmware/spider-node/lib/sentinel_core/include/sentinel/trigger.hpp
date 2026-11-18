#pragma once
// Streaming STA/LTA trigger: decides cheaply, sample by sample, whether a window is worth the
// cost of feature extraction + classification (most windows at a quiet site are not).
#include <cstdint>

namespace sentinel {

class StaLtaTrigger {
public:
    /// staS/ltaS in seconds at fs Hz. Exponential averages: O(1) memory and time per sample.
    StaLtaTrigger(float fs = 500.0f, float staS = 0.1f, float ltaS = 2.0f, float onRatio = 4.0f, float offRatio = 1.5f)
        : aSta_(1.0f / (staS * fs)), aLta_(1.0f / (ltaS * fs)), on_(onRatio), off_(offRatio) {}

    /// Feed one de-meaned sample. Returns true while the trigger is active.
    bool push(float x) {
        const float e = x * x;
        sta_ += aSta_ * (e - sta_);
        // Freeze the long-term average while triggered so the event cannot raise its own baseline.
        if (!active_) lta_ += aLta_ * (e - lta_);
        const float r = sta_ / (lta_ + 1e-6f);
        if (!active_ && warm_ >= warmup_ && r >= on_) active_ = true;
        else if (active_ && r <= off_) active_ = false;
        if (warm_ < warmup_) ++warm_;
        peakRatio_ = r > peakRatio_ ? r : peakRatio_;
        return active_;
    }

    bool active() const { return active_; }
    float peakRatio() const { return peakRatio_; }
    void resetPeak() { peakRatio_ = 0.0f; }

private:
    float aSta_, aLta_, on_, off_;
    float sta_ = 0.0f, lta_ = 0.0f, peakRatio_ = 0.0f;
    bool active_ = false;
    uint32_t warm_ = 0;
    static constexpr uint32_t warmup_ = 1000;  // 2 s at 500 Hz before the LTA is trusted
};

}  // namespace sentinel
