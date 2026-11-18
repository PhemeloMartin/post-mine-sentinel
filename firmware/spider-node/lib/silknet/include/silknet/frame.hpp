#pragma once
// SilkNet v1 frame codec (protocol/SILKNET.md). Big-endian header, AES-128-CCM payload.
#include <cstddef>
#include <cstdint>

namespace silknet {

enum class FrameType : uint8_t { Heartbeat = 0, Detection = 1, Pir = 2, Tamper = 3, Benign = 4, Ack = 5, Beacon = 6 };

constexpr uint8_t kVersion = 1;
constexpr std::size_t kHeaderLen = 10;
constexpr std::size_t kMicLen = 8;
constexpr std::size_t kPayloadLen = 14;
constexpr std::size_t kFrameLen = kHeaderLen + kPayloadLen + kMicLen;  // 32 bytes

struct Header {
    FrameType type = FrameType::Heartbeat;
    uint8_t flags = 0;  // bit0 ACK req · bit1 relayed · bits2-4 hop count (not authenticated)
    uint16_t site = 0;
    uint16_t node = 0;
    uint32_t counter = 0;

    uint8_t hops() const { return static_cast<uint8_t>((flags >> 2) & 0x07); }
    void setHops(uint8_t h) { flags = static_cast<uint8_t>((flags & ~0x1C) | ((h & 0x07) << 2)); }
};

struct Detection {
    uint32_t windowStart = 0;  // Unix seconds
    uint8_t classId = 0;
    uint8_t pThreatU8 = 0;     // round(p × 255)
    int8_t snrDb = 0;
    uint16_t arrivalMs = 0;    // 0..4000
    uint8_t batteryPct = 0;
    uint8_t status = 0;        // bit0 tamper · bit1 low battery · bit2 jamming suspected
};

void packDetection(const Detection& d, uint8_t out[kPayloadLen]);
bool unpackDetection(const uint8_t in[kPayloadLen], Detection& d);

/// Builds header + ciphertext + MIC into out (kFrameLen bytes). Returns false on bad input.
bool encode(const Header& h, const uint8_t payload[kPayloadLen], const uint8_t nodeKey[16], uint8_t out[kFrameLen]);

/// Parses and authenticates a frame. Fails closed: payload is untouched/zeroed on failure.
bool decode(const uint8_t* frame, std::size_t len, const uint8_t nodeKey[16], Header& h, uint8_t payload[kPayloadLen]);

/// Relays only rewrite the (unauthenticated) hop count — no re-encryption, no key needed.
bool incrementHops(uint8_t* frame, std::size_t len);

}  // namespace silknet
