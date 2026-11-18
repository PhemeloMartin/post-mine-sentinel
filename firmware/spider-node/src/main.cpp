// S.P.I.D.E.R. node — Seismic & Passive-Infrared Detection, Edge Relay.
//
//  [geophone]→ADS1115 ─500 Hz→ SamplerTask ─4 s window→ DspTask ─STA/LTA? features→MLP→ vote
//                                                                     │
//  [LIS3DH] TamperTask ─motion→ last-gasp TAMPER frame                ▼
//  [PIR] ISR ─────────────────────────────────────────────────→ RadioTask (SilkNet: LBT, duty
//                                                                cycle, ACK + retry, ETX parent)
//
// Failure handling: task watchdog (8 s) on every task; crash-loop detection drops the node into
// SAFE MODE (heartbeats only) after 3 consecutive abnormal resets; no key ⇒ never transmit;
// frame counters persisted ahead of use so (key, nonce) pairs are never reused.
#include <Adafruit_ADS1X15.h>
#include <Adafruit_LIS3DH.h>
#include <Arduino.h>
#include <Preferences.h>
#include <RadioLib.h>
#include <Wire.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include "board.h"
#include "sentinel/classifier.hpp"
#include "sentinel/features.hpp"
#include "sentinel/status.hpp"
#include "sentinel/trigger.hpp"
#include "silknet/frame.hpp"
#include "silknet/link.hpp"

using sentinel::Status;

namespace {

// ------------------------------------------------------------------ state

SX1262 radio = new Module(LORA_NSS, LORA_DIO1, LORA_RST, LORA_BUSY);
Adafruit_ADS1115 ads;
Adafruit_LIS3DH lis;
Preferences prefs;

RTC_NOINIT_ATTR uint32_t gCrashCount;  // survives soft resets, not power loss
bool gSafeMode = false;
bool gProvisioned = false;
uint8_t gNodeKey[16];
uint16_t gSiteId = 0;
uint16_t gNodeId = 0;

int16_t gBuf[2][sentinel::kWindow];  // double buffer: sampler fills one while DSP reads the other
volatile int gFill = 0;
volatile size_t gIdx = 0;
volatile uint32_t gWindowStartUnix = 0;
int64_t gUnixOffsetMs = 0;  // Unix time = millis() + offset, disciplined by anchor beacons

sentinel::FeatureWorkspace gWs;  // static: far too large for a task stack
QueueHandle_t gWindows;          // index of a full buffer
QueueHandle_t gTx;               // outbound frames
volatile bool gPirFlag = false;
volatile uint8_t gStatusBits = 0;

struct TxItem {
    uint8_t frame[silknet::kFrameLen];
    uint8_t attempts;
};

silknet::DutyCycle gDuty(36'000);  // 1 % of an hour
silknet::Router gRouter;

uint32_t nowUnix() { return static_cast<uint32_t>((static_cast<int64_t>(millis()) + gUnixOffsetMs) / 1000); }

uint8_t batteryPct() {
    const float v = analogReadMilliVolts(BATTERY_ADC) * 4.9f / 1000.0f;  // divider ratio
    const float pct = (v - 3.3f) / (4.15f - 3.3f) * 100.0f;               // Li-ion SoC (approx.)
    return static_cast<uint8_t>(constrain(pct, 0.0f, 100.0f));
}

bool persistCounter(uint32_t reserved, void*) { return prefs.putUInt("ctr", reserved) == sizeof(uint32_t); }

silknet::FrameCounter* gCounter = nullptr;

void logStatus(const char* where, Status s) {
    if (!sentinel::ok(s)) log_e("%s failed: %s", where, sentinel::toString(s));
}

// ------------------------------------------------------------------ framing

Status queueFrame(silknet::FrameType type, const silknet::Detection& d) {
    if (!gProvisioned) return Status::AuthFailed;  // fail closed: never send unauthenticated data
    uint32_t counter = 0;
    if (!gCounter->next(counter)) return Status::StorageFailed;
    silknet::Header h;
    h.type = type;
    h.site = gSiteId;
    h.node = gNodeId;
    h.counter = counter;
    h.flags = 0x01;  // ACK requested
    uint8_t payload[silknet::kPayloadLen];
    silknet::packDetection(d, payload);
    TxItem item{};
    if (!silknet::encode(h, payload, gNodeKey, item.frame)) return Status::InvalidArgument;
    // Tamper frames jump the queue: they may be the last thing this node ever sends.
    const BaseType_t ok = type == silknet::FrameType::Tamper ? xQueueSendToFront(gTx, &item, 0) : xQueueSend(gTx, &item, 0);
    return ok == pdTRUE ? Status::Ok : Status::BufferTooSmall;
}

// ------------------------------------------------------------------ tasks

void IRAM_ATTR onPir() { gPirFlag = true; }

void samplerTask(void*) {
    esp_task_wdt_add(nullptr);
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(2));  // 500 Hz
        const int16_t s = ads.getLastConversionResults();
        if (s == INT16_MAX || s == INT16_MIN) gStatusBits |= 0x08;  // saturation (blast or tamper)
        gBuf[gFill][gIdx] = s;
        if (gIdx == 0) gWindowStartUnix = nowUnix();
        if (++gIdx >= sentinel::kWindow) {
            const int full = gFill;
            gFill ^= 1;
            gIdx = 0;
            if (xQueueSend(gWindows, &full, 0) != pdTRUE) log_w("DSP overrun: window dropped");
        }
        esp_task_wdt_reset();
    }
}

void dspTask(void*) {
    esp_task_wdt_add(nullptr);
    sentinel::StaLtaTrigger trigger;
    for (;;) {
        int idx;
        if (xQueueReceive(gWindows, &idx, pdMS_TO_TICKS(5000)) != pdTRUE) {
            logStatus("sampler", Status::SensorTimeout);
            esp_task_wdt_reset();
            continue;
        }
        const int16_t* w = gBuf[idx];
        long sum = 0;
        for (size_t i = 0; i < sentinel::kWindow; ++i) sum += w[i];
        const float mean = static_cast<float>(sum) / sentinel::kWindow;
        bool triggered = false;
        for (size_t i = 0; i < sentinel::kWindow; ++i) triggered |= trigger.push(w[i] - mean);
        const float snr = 10.0f * log10f(trigger.peakRatio() + 1e-6f);
        trigger.resetPeak();

        if (triggered && !gSafeMode) {
            sentinel::FeatureVector f{};
            const Status s = sentinel::extractFeatures(w, sentinel::kWindow, f, gWs);
            if (sentinel::ok(s)) {
                const auto c = sentinel::classify(f);
                silknet::Detection d;
                d.windowStart = gWindowStartUnix;
                d.classId = static_cast<uint8_t>(c.label);
                d.pThreatU8 = static_cast<uint8_t>(lroundf(c.pThreat * 255.0f));
                d.snrDb = static_cast<int8_t>(constrain(snr, -60.0f, 120.0f));
                d.batteryPct = batteryPct();
                d.status = gStatusBits;
                logStatus("queue", queueFrame(c.alarm ? silknet::FrameType::Detection : silknet::FrameType::Benign, d));
            } else {
                logStatus("features", s);
            }
        }
        if (gPirFlag) {
            gPirFlag = false;
            silknet::Detection d;
            d.windowStart = gWindowStartUnix;
            d.pThreatU8 = 255;
            d.batteryPct = batteryPct();
            logStatus("queue pir", queueFrame(silknet::FrameType::Pir, d));
        }
        esp_task_wdt_reset();
    }
}

void tamperTask(void*) {
    esp_task_wdt_add(nullptr);
    sensors_event_t e;
    lis.getEvent(&e);
    float bx = e.acceleration.x, by = e.acceleration.y, bz = e.acceleration.z;
    int strikes = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(200));
        lis.getEvent(&e);
        const float dx = e.acceleration.x - bx, dy = e.acceleration.y - by, dz = e.acceleration.z - bz;
        // > 0.35 g change of orientation for 3 consecutive samples = node lifted / web torn.
        strikes = (dx * dx + dy * dy + dz * dz) > 12.0f ? strikes + 1 : 0;
        if (strikes == 3) {
            gStatusBits |= 0x01;
            silknet::Detection d;
            d.windowStart = nowUnix();
            d.pThreatU8 = 255;
            d.batteryPct = batteryPct();
            d.status = gStatusBits;
            logStatus("tamper", queueFrame(silknet::FrameType::Tamper, d));
        }
        esp_task_wdt_reset();
    }
}

void radioTask(void*) {
    esp_task_wdt_add(nullptr);
    TxItem item;
    for (;;) {
        if (xQueueReceive(gTx, &item, pdMS_TO_TICKS(1000)) == pdTRUE) {
            const uint32_t air = silknet::timeOnAirMs(silknet::kFrameLen, SILKNET_SF);
            if (gRouter.parent() == silknet::Router::kNone) {
                logStatus("route", Status::NoRoute);  // keep it: store-and-forward
                xQueueSendToBack(gTx, &item, 0);
                vTaskDelay(pdMS_TO_TICKS(2000));
            } else if (!gDuty.tryConsume(air, millis())) {
                logStatus("tx", Status::DutyCycleExceeded);  // legal limit: wait, never exceed
                xQueueSendToFront(gTx, &item, 0);
                vTaskDelay(pdMS_TO_TICKS(5000));
            } else if (radio.scanChannel() != RADIOLIB_CHANNEL_FREE) {
                logStatus("lbt", Status::RadioBusy);  // listen-before-talk: random back-off
                xQueueSendToFront(gTx, &item, 0);
                vTaskDelay(pdMS_TO_TICKS(random(50, 400)));
            } else {
                const int st = radio.transmit(item.frame, silknet::kFrameLen);
                const bool sent = st == RADIOLIB_ERR_NONE;
                gRouter.onAck(gRouter.parent(), sent);
                if (!sent && ++item.attempts < 4) {
                    logStatus("tx", Status::RadioTxFailed);
                    xQueueSendToFront(gTx, &item, 0);
                    vTaskDelay(pdMS_TO_TICKS((1u << item.attempts) * 200u + random(0, 200)));
                }
                radio.startReceive();  // listen for beacons/ACKs between transmissions
            }
        }
        esp_task_wdt_reset();
    }
}

void heartbeatTask(void*) {
    for (;;) {
        silknet::Detection d;
        d.windowStart = nowUnix();
        d.batteryPct = batteryPct();
        d.status = static_cast<uint8_t>(gStatusBits | (d.batteryPct < 15 ? 0x02 : 0));
        logStatus("heartbeat", queueFrame(silknet::FrameType::Heartbeat, d));
        vTaskDelay(pdMS_TO_TICKS(300'000));
    }
}

}  // namespace

// ------------------------------------------------------------------ boot

void setup() {
    Serial.begin(115200);
    pinMode(LED_PIN, OUTPUT);

    // Crash-loop protection: three abnormal resets in a row ⇒ safe mode.
    const esp_reset_reason_t why = esp_reset_reason();
    if (why == ESP_RST_POWERON) gCrashCount = 0;
    else if (why == ESP_RST_TASK_WDT || why == ESP_RST_PANIC || why == ESP_RST_INT_WDT) ++gCrashCount;
    gSafeMode = gCrashCount >= 3;
    if (gSafeMode) log_e("SAFE MODE after %u abnormal resets: sensing disabled, heartbeats only", gCrashCount);

    prefs.begin("silknet", false);
    gProvisioned = prefs.getBytes("key", gNodeKey, sizeof(gNodeKey)) == sizeof(gNodeKey);
    gSiteId = prefs.getUShort("site", 0);
    gNodeId = prefs.getUShort("node", 0);
    static silknet::FrameCounter counter(prefs.getUInt("ctr", 0), persistCounter, nullptr);
    gCounter = &counter;
    if (!gProvisioned || gSiteId == 0 || gNodeId == 0) log_e("node not provisioned: transmissions disabled");

    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
    const int st = radio.begin(SILKNET_FREQ_MHZ, SILKNET_BW_KHZ, SILKNET_SF, SILKNET_CR, SILKNET_SYNC_WORD, SILKNET_TX_DBM,
                               SILKNET_PREAMBLE, SILKNET_TCXO_V);
    if (st != RADIOLIB_ERR_NONE) log_e("radio init failed (%d)", st);
    gRouter.onBeacon(0xFF01, 0.0f);  // until beacons arrive, assume the configured anchor

    Wire.begin(SENSOR_SDA, SENSOR_SCL, 400000);
    if (!ads.begin()) log_e("ADS1115 not found: seismic channel offline");
    ads.setGain(GAIN_SIXTEEN);  // ±256 mV: geophone outputs are small
    ads.setDataRate(RATE_ADS1115_860SPS);
    ads.startADCReading(ADS1X15_REG_CONFIG_MUX_DIFF_0_1, /*continuous=*/true);
    if (!lis.begin(0x18)) log_e("LIS3DH not found: tamper detection degraded");
    lis.setRange(LIS3DH_RANGE_2_G);
    pinMode(PIR_PIN, INPUT);
    attachInterrupt(digitalPinToInterrupt(PIR_PIN), onPir, RISING);

    esp_task_wdt_init(8, true);  // panic + reset if any registered task stalls for 8 s
    gWindows = xQueueCreate(2, sizeof(int));
    gTx = xQueueCreate(16, sizeof(TxItem));
    xTaskCreatePinnedToCore(samplerTask, "sampler", 3072, nullptr, 5, nullptr, 1);
    xTaskCreatePinnedToCore(dspTask, "dsp", 6144, nullptr, 3, nullptr, 1);
    xTaskCreatePinnedToCore(radioTask, "radio", 4096, nullptr, 4, nullptr, 0);
    xTaskCreatePinnedToCore(tamperTask, "tamper", 3072, nullptr, 2, nullptr, 0);
    xTaskCreatePinnedToCore(heartbeatTask, "heartbeat", 3072, nullptr, 1, nullptr, 0);
    log_i("S.P.I.D.E.R. %s site %u node %u up", SPIDER_FW_VERSION, gSiteId, gNodeId);
}

void loop() {
    // Healthy uptime clears the crash counter; status LED blinks a heartbeat (off in the field build).
    static uint32_t since = millis();
    if (millis() - since > 600'000) gCrashCount = 0;
    digitalWrite(LED_PIN, (millis() / 1000) % 10 == 0);
    vTaskDelay(pdMS_TO_TICKS(500));
}
