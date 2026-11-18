#pragma once
// Node-side link-layer policy: regulatory duty cycle, nonce-safe frame counters and ETX routing.
// Header-only and hardware-independent so it is fully unit-testable on the host.
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace silknet {

/// LoRa time on air in milliseconds (Semtech AN1200.13), CR 4/5, explicit header, CRC on.
inline uint32_t timeOnAirMs(std::size_t payloadBytes, int sf = 9, double bwHz = 125e3, int preamble = 8) {
    const double tSym = std::pow(2.0, sf) / bwHz;
    const int de = tSym > 0.016 ? 1 : 0;
    const double num = 8.0 * static_cast<double>(payloadBytes) - 4.0 * sf + 28 + 16;
    const double den = 4.0 * (sf - 2 * de);
    const double nPayload = 8 + std::fmax(std::ceil(num / den) * 5.0, 0.0);
    return static_cast<uint32_t>(std::lround(((preamble + 4.25) + nPayload) * tSym * 1000.0));
}

/// Rolling one-hour airtime budget (60 one-minute buckets). Default 1 % of 3 600 s = 36 s.
class DutyCycle {
public:
    explicit DutyCycle(uint32_t budgetMsPerHour = 36'000) : budget_(budgetMsPerHour) {}

    /// True if `airMs` may be transmitted now; records it if so. nowMs: monotonic milliseconds.
    bool tryConsume(uint32_t airMs, uint64_t nowMs) {
        advance(nowMs);
        if (used_ + airMs > budget_) return false;
        buckets_[cursor_] += airMs;
        used_ += airMs;
        return true;
    }
    uint32_t usedMs(uint64_t nowMs) {
        advance(nowMs);
        return used_;
    }

private:
    void advance(uint64_t nowMs) {
        const uint64_t minute = nowMs / 60'000;
        if (!started_) {
            started_ = true;
            lastMinute_ = minute;
            return;
        }
        uint64_t steps = minute - lastMinute_;
        if (steps > 60) steps = 60;
        for (uint64_t i = 0; i < steps; ++i) {
            cursor_ = (cursor_ + 1) % 60;
            used_ -= buckets_[cursor_];  // drop the minute that is now an hour old
            buckets_[cursor_] = 0;
        }
        lastMinute_ = minute;
    }

    uint32_t budget_;
    std::array<uint32_t, 60> buckets_{};
    std::size_t cursor_ = 0;
    uint32_t used_ = 0;
    uint64_t lastMinute_ = 0;
    bool started_ = false;
};

/// Frame counter that can never repeat across resets: counters are reserved from flash in
/// blocks, so a reboot skips at most one block instead of reusing (key, nonce) pairs, and flash
/// is written once per `kBlock` frames instead of every frame (wear levelling).
class FrameCounter {
public:
    static constexpr uint32_t kBlock = 64;
    using Persist = bool (*)(uint32_t reservedUpTo, void* ctx);

    FrameCounter(uint32_t storedReservation, Persist persist, void* ctx)
        : next_(storedReservation), reserved_(storedReservation), persist_(persist), ctx_(ctx) {}

    /// Returns false (and never a reused value) if the reservation could not be persisted.
    bool next(uint32_t& out) {
        if (next_ >= reserved_) {
            if (reserved_ > UINT32_MAX - kBlock) return false;  // exhausted: node must be re-keyed
            if (!persist_(reserved_ + kBlock, ctx_)) return false;
            reserved_ += kBlock;
        }
        out = next_++;
        return true;
    }

private:
    uint32_t next_, reserved_;
    Persist persist_;
    void* ctx_;
};

/// Parent selection by expected transmission count: ETX_via = ETX_parent + 1 / PRR_link.
/// Link PRR is an exponentially weighted average of ACK outcomes.
class Router {
public:
    static constexpr std::size_t kMaxNeighbours = 12;
    static constexpr uint16_t kNone = 0;

    void onBeacon(uint16_t neighbour, float advertisedEtx) {
        Entry* e = find(neighbour, true);
        if (e) e->etx = advertisedEtx;
    }
    void onAck(uint16_t neighbour, bool delivered) {
        Entry* e = find(neighbour, false);
        if (e) e->prr = 0.8f * e->prr + 0.2f * (delivered ? 1.0f : 0.0f);
    }
    void forget(uint16_t neighbour) {
        Entry* e = find(neighbour, false);
        if (e) e->used = false;
    }
    /// Best parent, or kNone when no usable route exists (caller stores and forwards later).
    uint16_t parent(float* etxOut = nullptr) const {
        uint16_t best = kNone;
        float bestEtx = 1e9f;
        for (const Entry& e : table_) {
            if (!e.used || e.prr < 0.1f) continue;
            const float etx = e.etx + 1.0f / e.prr;
            if (etx < bestEtx) {
                bestEtx = etx;
                best = e.id;
            }
        }
        if (etxOut) *etxOut = bestEtx;
        return best;
    }

private:
    struct Entry {
        uint16_t id = 0;
        float etx = 1e9f;
        float prr = 0.9f;  // optimistic prior for a freshly heard neighbour
        bool used = false;
    };
    Entry* find(uint16_t id, bool create) {
        Entry* freeSlot = nullptr;
        for (Entry& e : table_) {
            if (e.used && e.id == id) return &e;
            if (!e.used && !freeSlot) freeSlot = &e;
        }
        if (!create || !freeSlot) return nullptr;
        *freeSlot = Entry{id, 1e9f, 0.9f, true};
        return freeSlot;
    }
    std::array<Entry, kMaxNeighbours> table_{};
};

}  // namespace silknet
