// Host-side unit tests (PlatformIO `native` env + Unity). Run: pio test -e native
#include <unity.h>

#include <cmath>
#include <cstring>
#include <random>

#include "../golden/golden_vectors.h"
#include "../golden/silknet_vectors.h"
#include "sentinel/classifier.hpp"
#include "sentinel/features.hpp"
#include "sentinel/trigger.hpp"
#include "silknet/crypto.hpp"
#include "silknet/frame.hpp"
#include "silknet/link.hpp"

using namespace silknet;
namespace v = silknet::vectors;
namespace g = sentinel::golden;

static sentinel::FeatureWorkspace gWs;  // ~66 KB: static, as on the MCU

void setUp() {}
void tearDown() {}

// ---------------------------------------------------------------- crypto conformance

void test_aes128_fips197() {
    uint8_t out[16];
    Aes128(v::kFipsKey).encryptBlock(v::kFipsPlain, out);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(v::kFipsCipher, out, 16);
}

void test_ccm_rfc3610_vector1() {
    uint8_t out[31];
    TEST_ASSERT_TRUE(ccmSeal(v::kRfcKey, v::kRfcNonce, v::kRfcAad, 8, v::kRfcPlain, 23, out, 8));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(v::kRfcOut, out, 31);
    uint8_t plain[23];
    TEST_ASSERT_TRUE(ccmOpen(v::kRfcKey, v::kRfcNonce, v::kRfcAad, 8, v::kRfcOut, 31, plain, 8));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(v::kRfcPlain, plain, 23);
}

void test_ccm_rejects_tampering_and_zeroes_output() {
    uint8_t bad[31];
    std::memcpy(bad, v::kRfcOut, 31);
    bad[12] ^= 0x01;
    uint8_t plain[23];
    std::memset(plain, 0xAA, sizeof(plain));
    TEST_ASSERT_FALSE(ccmOpen(v::kRfcKey, v::kRfcNonce, v::kRfcAad, 8, bad, 31, plain, 8));
    for (uint8_t b : plain) TEST_ASSERT_EQUAL_UINT8(0, b);
}

// ---------------------------------------------------------------- SilkNet frames

void test_frames_match_shared_vectors() {
    for (std::size_t i = 0; i < v::kNumFrames; ++i) {
        const auto& f = v::kFrames[i];
        Header h;
        h.type = static_cast<FrameType>(f.type);
        h.flags = f.flags;
        h.site = f.site;
        h.node = f.node;
        h.counter = f.counter;
        uint8_t out[kFrameLen];
        TEST_ASSERT_TRUE_MESSAGE(encode(h, f.payload, f.key, out), f.name);
        TEST_ASSERT_EQUAL_HEX8_ARRAY_MESSAGE(f.frame, out, kFrameLen, f.name);

        Header back;
        uint8_t payload[kPayloadLen];
        TEST_ASSERT_TRUE_MESSAGE(decode(f.frame, kFrameLen, f.key, back, payload), f.name);
        TEST_ASSERT_EQUAL_HEX8_ARRAY(f.payload, payload, kPayloadLen);
        TEST_ASSERT_EQUAL_UINT32(f.counter, back.counter);
    }
}

void test_relay_hop_increment_keeps_authentication() {
    const auto& f = v::kFrames[0];
    uint8_t frame[kFrameLen];
    std::memcpy(frame, f.frame, kFrameLen);
    TEST_ASSERT_TRUE(incrementHops(frame, kFrameLen));
    Header h;
    uint8_t payload[kPayloadLen];
    TEST_ASSERT_TRUE(decode(frame, kFrameLen, f.key, h, payload));
    TEST_ASSERT_EQUAL_UINT8(1, h.hops());
    frame[6] ^= 0x01;  // counter byte is authenticated
    TEST_ASSERT_FALSE(decode(frame, kFrameLen, f.key, h, payload));
}

void test_hop_limit_prevents_loops() {
    uint8_t frame[kFrameLen];
    std::memcpy(frame, v::kFrames[0].frame, kFrameLen);
    for (int i = 0; i < 7; ++i) TEST_ASSERT_TRUE(incrementHops(frame, kFrameLen));
    TEST_ASSERT_FALSE(incrementHops(frame, kFrameLen));
}

// ---------------------------------------------------------------- DSP + ML parity with Python

static float tolerance(int feature) {
    switch (feature) {
        case 15: return 0.06f;   // cadence_hz: lag argmax can tie
        case 18: return 0.26f;   // impulse_rate: ±1 borderline peak
        case 19: return 0.20f;   // impulse_cv
        case 20: return 0.01f;   // active_fraction
        default: return 2e-3f;
    }
}

void test_features_match_python_golden_vectors() {
    for (int i = 0; i < g::kNumVectors; ++i) {
        sentinel::FeatureVector f{};
        TEST_ASSERT_EQUAL(sentinel::Status::Ok, sentinel::extractFeatures(g::kRaw[i], g::kWindow, f, gWs));
        for (int k = 0; k < g::kNumFeatures; ++k) {
            const float want = g::kFeatures[i][k];
            const float tol = k == 8 ? std::fmax(2e-3f, std::fabs(want) * 1e-3f) : tolerance(k);
            TEST_ASSERT_FLOAT_WITHIN_MESSAGE(tol, want, f[k], sentinel::model::kFeatureNames[k]);
        }
    }
}

void test_classifier_matches_python_probabilities() {
    for (int i = 0; i < g::kNumVectors; ++i) {
        sentinel::FeatureVector f{};
        for (int k = 0; k < g::kNumFeatures; ++k) f[k] = g::kFeatures[i][k];
        const auto c = sentinel::classify(f);
        for (int j = 0; j < g::kNumClasses; ++j) TEST_ASSERT_FLOAT_WITHIN(1e-3f, g::kProba[i][j], c.proba[j]);
    }
}

void test_end_to_end_label_matches_python() {
    for (int i = 0; i < g::kNumVectors; ++i) {
        sentinel::FeatureVector f{};
        TEST_ASSERT_EQUAL(sentinel::Status::Ok, sentinel::extractFeatures(g::kRaw[i], g::kWindow, f, gWs));
        const auto c = sentinel::classify(f);
        int want = 0;
        for (int j = 1; j < g::kNumClasses; ++j)
            if (g::kProba[i][j] > g::kProba[i][want]) want = j;
        TEST_ASSERT_EQUAL_INT(want, c.label);
    }
}

void test_feature_extraction_rejects_bad_input() {
    sentinel::FeatureVector f{};
    TEST_ASSERT_EQUAL(sentinel::Status::InvalidArgument, sentinel::extractFeatures(nullptr, g::kWindow, f, gWs));
    TEST_ASSERT_EQUAL(sentinel::Status::BufferTooSmall, sentinel::extractFeatures(g::kRaw[0], 10, f, gWs));
}

void test_sta_lta_triggers_on_impulse_and_releases() {
    sentinel::StaLtaTrigger trig;
    std::mt19937 rng(7);
    std::normal_distribution<float> noise(0.0f, 20.0f);
    bool fired = false;
    for (int i = 0; i < 3000; ++i) TEST_ASSERT_FALSE(trig.push(noise(rng)));
    for (int i = 0; i < 40; ++i) fired |= trig.push(noise(rng) + 600.0f * std::exp(-i / 10.0f));
    TEST_ASSERT_TRUE(fired);
    for (int i = 0; i < 3000; ++i) trig.push(noise(rng));
    TEST_ASSERT_FALSE(trig.active());
}

// ---------------------------------------------------------------- link layer

void test_time_on_air_reference_values() {
    TEST_ASSERT_EQUAL_UINT32(41, timeOnAirMs(10, 7));   // Semtech calculator: 41.216 ms
    TEST_ASSERT_EQUAL_UINT32(247, timeOnAirMs(32, 9));  // SilkNet detection frame
}

void test_duty_cycle_budget_and_recovery() {
    DutyCycle dc(1000);
    TEST_ASSERT_TRUE(dc.tryConsume(600, 0));
    TEST_ASSERT_FALSE(dc.tryConsume(600, 1000));        // would exceed 1 000 ms/hour
    TEST_ASSERT_TRUE(dc.tryConsume(400, 2000));
    TEST_ASSERT_TRUE(dc.tryConsume(600, 61ull * 60'000));  // an hour later the budget is back
}

struct Flash {
    uint32_t stored = 0;
    bool fail = false;
};
static bool persist(uint32_t v, void* ctx) {
    auto* f = static_cast<Flash*>(ctx);
    if (f->fail) return false;
    f->stored = v;
    return true;
}

void test_frame_counter_never_repeats_across_reboots() {
    Flash flash;
    uint32_t last = 0, c = 0;
    {
        FrameCounter fc(flash.stored, persist, &flash);
        for (int i = 0; i < 100; ++i) {
            TEST_ASSERT_TRUE(fc.next(c));
            last = c;
        }
    }
    FrameCounter afterReboot(flash.stored, persist, &flash);  // power loss mid-block
    TEST_ASSERT_TRUE(afterReboot.next(c));
    TEST_ASSERT_TRUE(c > last);
    flash.fail = true;
    FrameCounter broken(flash.stored, persist, &flash);
    TEST_ASSERT_FALSE(broken.next(c));  // fail closed: no transmission without a persisted counter
}

void test_router_prefers_lowest_etx_and_reroutes() {
    Router r;
    r.onBeacon(0xFF01, 0.0f);  // anchor A1
    r.onBeacon(10, 1.2f);      // a node already two hops from an anchor
    TEST_ASSERT_EQUAL_UINT16(0xFF01, r.parent());
    for (int i = 0; i < 12; ++i) r.onAck(0xFF01, false);  // A1 jammed
    TEST_ASSERT_EQUAL_UINT16(10, r.parent());
    r.forget(10);
    TEST_ASSERT_EQUAL_UINT16(Router::kNone, r.parent());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_aes128_fips197);
    RUN_TEST(test_ccm_rfc3610_vector1);
    RUN_TEST(test_ccm_rejects_tampering_and_zeroes_output);
    RUN_TEST(test_frames_match_shared_vectors);
    RUN_TEST(test_relay_hop_increment_keeps_authentication);
    RUN_TEST(test_hop_limit_prevents_loops);
    RUN_TEST(test_features_match_python_golden_vectors);
    RUN_TEST(test_classifier_matches_python_probabilities);
    RUN_TEST(test_end_to_end_label_matches_python);
    RUN_TEST(test_feature_extraction_rejects_bad_input);
    RUN_TEST(test_sta_lta_triggers_on_impulse_and_releases);
    RUN_TEST(test_time_on_air_reference_values);
    RUN_TEST(test_duty_cycle_budget_and_recovery);
    RUN_TEST(test_frame_counter_never_repeats_across_reboots);
    RUN_TEST(test_router_prefers_lowest_etx_and_reroutes);
    return UNITY_END();
}
