#pragma once
// Error handling on the node: no exceptions (disabled on the MCU), every fallible call returns a
// Status; callers must check it ([[nodiscard]]). Codes are also sent in heartbeat frames so the
// SOC can see field faults without a site visit.
#include <cstdint>

namespace sentinel {

enum class Status : uint8_t {
    Ok = 0,
    InvalidArgument,
    BufferTooSmall,
    SensorTimeout,
    SensorSaturated,   // ADC clipping: geophone overdriven (blast or tamper)
    RadioBusy,         // channel occupied (listen-before-talk)
    RadioTxFailed,
    DutyCycleExceeded, // regulatory airtime budget exhausted for this hour
    NoRoute,           // no parent to forward to
    AuthFailed,
    StorageFailed,
};

constexpr const char* toString(Status s) {
    switch (s) {
        case Status::Ok: return "ok";
        case Status::InvalidArgument: return "invalid_argument";
        case Status::BufferTooSmall: return "buffer_too_small";
        case Status::SensorTimeout: return "sensor_timeout";
        case Status::SensorSaturated: return "sensor_saturated";
        case Status::RadioBusy: return "radio_busy";
        case Status::RadioTxFailed: return "radio_tx_failed";
        case Status::DutyCycleExceeded: return "duty_cycle_exceeded";
        case Status::NoRoute: return "no_route";
        case Status::AuthFailed: return "auth_failed";
        case Status::StorageFailed: return "storage_failed";
    }
    return "unknown";
}

constexpr bool ok(Status s) { return s == Status::Ok; }

}  // namespace sentinel
