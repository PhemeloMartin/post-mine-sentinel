#pragma once
// Portable AES-128 (encrypt direction only — all CCM needs) and AES-CCM (RFC 3610, L = 2).
// On ESP32 builds this can be swapped for the hardware AES peripheral via mbedTLS; the portable
// version is what the native unit tests verify against FIPS-197 and RFC 3610 vectors.
#include <cstddef>
#include <cstdint>

namespace silknet {

class Aes128 {
public:
    explicit Aes128(const uint8_t key[16]);
    ~Aes128();  // wipes the round keys
    void encryptBlock(const uint8_t in[16], uint8_t out[16]) const;

private:
    uint8_t rk_[176];
};

constexpr std::size_t kNonceLen = 13;

/// out must hold len + tagLen bytes. Returns false on invalid lengths.
bool ccmSeal(const uint8_t key[16], const uint8_t nonce[kNonceLen], const uint8_t* aad, std::size_t aadLen,
             const uint8_t* plain, std::size_t len, uint8_t* out, std::size_t tagLen);

/// Verifies the tag in constant time; on failure the plaintext buffer is zeroed and false returned.
bool ccmOpen(const uint8_t key[16], const uint8_t nonce[kNonceLen], const uint8_t* aad, std::size_t aadLen,
             const uint8_t* sealed, std::size_t sealedLen, uint8_t* plain, std::size_t tagLen);

}  // namespace silknet
