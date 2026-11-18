#include "silknet/frame.hpp"

#include <cstring>

#include "silknet/crypto.hpp"

namespace silknet {
namespace {

void putU16(uint8_t* p, uint16_t v) {
    p[0] = static_cast<uint8_t>(v >> 8);
    p[1] = static_cast<uint8_t>(v);
}
void putU32(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v >> 24);
    p[1] = static_cast<uint8_t>(v >> 16);
    p[2] = static_cast<uint8_t>(v >> 8);
    p[3] = static_cast<uint8_t>(v);
}
uint16_t getU16(const uint8_t* p) { return static_cast<uint16_t>((p[0] << 8) | p[1]); }
uint32_t getU32(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) | (static_cast<uint32_t>(p[2]) << 8) | p[3];
}

void nonceFor(const Header& h, uint8_t n[kNonceLen]) {
    std::memset(n, 0, kNonceLen);
    putU16(n, h.site);
    putU16(n + 2, h.node);
    putU32(n + 4, h.counter);
    n[8] = 0x00;  // uplink
}

/// AAD = byte 0 ‖ bytes 2..9 (the mutable flags byte is excluded).
void aadFor(const uint8_t* header, uint8_t aad[kHeaderLen - 1]) {
    aad[0] = header[0];
    std::memcpy(aad + 1, header + 2, kHeaderLen - 2);
}

std::size_t payloadLenFor(FrameType t) { return t == FrameType::Ack ? 0 : kPayloadLen; }

}  // namespace

void packDetection(const Detection& d, uint8_t out[kPayloadLen]) {
    std::memset(out, 0, kPayloadLen);
    putU32(out, d.windowStart);
    out[4] = d.classId;
    out[5] = d.pThreatU8;
    out[6] = static_cast<uint8_t>(d.snrDb);
    putU16(out + 7, d.arrivalMs > 4000 ? 4000 : d.arrivalMs);
    out[9] = d.batteryPct > 100 ? 100 : d.batteryPct;
    out[10] = d.status;
}

bool unpackDetection(const uint8_t in[kPayloadLen], Detection& d) {
    d.windowStart = getU32(in);
    d.classId = in[4];
    d.pThreatU8 = in[5];
    d.snrDb = static_cast<int8_t>(in[6]);
    d.arrivalMs = getU16(in + 7);
    d.batteryPct = in[9];
    d.status = in[10];
    return d.classId <= 6 && d.arrivalMs <= 4000 && d.batteryPct <= 100;
}

bool encode(const Header& h, const uint8_t payload[kPayloadLen], const uint8_t nodeKey[16], uint8_t out[kFrameLen]) {
    if (payloadLenFor(h.type) != kPayloadLen) return false;  // ACKs are downlink-only on anchors
    out[0] = static_cast<uint8_t>((kVersion << 4) | (static_cast<uint8_t>(h.type) & 0x0F));
    out[1] = h.flags;
    putU16(out + 2, h.site);
    putU16(out + 4, h.node);
    putU32(out + 6, h.counter);
    uint8_t nonce[kNonceLen];
    uint8_t aad[kHeaderLen - 1];
    nonceFor(h, nonce);
    aadFor(out, aad);
    return ccmSeal(nodeKey, nonce, aad, sizeof(aad), payload, kPayloadLen, out + kHeaderLen, kMicLen);
}

bool decode(const uint8_t* frame, std::size_t len, const uint8_t nodeKey[16], Header& h, uint8_t payload[kPayloadLen]) {
    if (frame == nullptr || len < kHeaderLen + kMicLen) return false;
    if ((frame[0] >> 4) != kVersion) return false;
    h.type = static_cast<FrameType>(frame[0] & 0x0F);
    h.flags = frame[1];
    h.site = getU16(frame + 2);
    h.node = getU16(frame + 4);
    h.counter = getU32(frame + 6);
    const std::size_t pl = payloadLenFor(h.type);
    if (len != kHeaderLen + pl + kMicLen) return false;
    uint8_t nonce[kNonceLen];
    uint8_t aad[kHeaderLen - 1];
    nonceFor(h, nonce);
    aadFor(frame, aad);
    return ccmOpen(nodeKey, nonce, aad, sizeof(aad), frame + kHeaderLen, pl + kMicLen, payload, kMicLen);
}

bool incrementHops(uint8_t* frame, std::size_t len) {
    if (frame == nullptr || len < kHeaderLen) return false;
    const uint8_t hops = static_cast<uint8_t>((frame[1] >> 2) & 0x07);
    if (hops >= 7) return false;  // TTL exhausted: drop to prevent routing loops
    frame[1] = static_cast<uint8_t>((frame[1] & ~0x1C) | (((hops + 1) & 0x07) << 2) | 0x02);  // + relayed bit
    return true;
}

}  // namespace silknet
