#pragma once
// Pin map: Heltec WiFi LoRa 32 V3 (ESP32-S3FN8 + SX1262) prototype carrier.
// Production target (ADR-0006): STM32WLE5 SoC on a 30 × 22 mm "spider body" PCB.

// SX1262 (on-board)
#define LORA_NSS 8
#define LORA_SCK 9
#define LORA_MOSI 10
#define LORA_MISO 11
#define LORA_RST 12
#define LORA_BUSY 13
#define LORA_DIO1 14

// I2C sensor bus: ADS1115 (geophone, differential A0-A1) + LIS3DH (tamper accelerometer)
#define SENSOR_SDA 41
#define SENSOR_SCL 42
#define ADS_ALERT_RDY 7
#define PIR_PIN 6           // Panasonic EKMB low-power PIR, active high
#define BATTERY_ADC 1       // 100k/390k divider on the Heltec V3
#define LED_PIN 35

// Radio plan (ICASA licence-exempt SRD band — confirm channel plan before deployment)
#define SILKNET_FREQ_MHZ 868.1f
#define SILKNET_BW_KHZ 125.0f
#define SILKNET_SF 9
#define SILKNET_CR 5
#define SILKNET_SYNC_WORD 0x2B  // private network (not LoRaWAN's 0x34)
#define SILKNET_TX_DBM 14
#define SILKNET_PREAMBLE 8
#define SILKNET_TCXO_V 1.8f
