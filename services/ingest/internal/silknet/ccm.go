// Package silknet implements the SilkNet v1 frame format (protocol/SILKNET.md).
package silknet

import (
	"crypto/cipher"
	"crypto/subtle"
	"encoding/binary"
	"errors"
)

// ErrAuth is returned when a frame's CCM authentication tag does not verify.
var ErrAuth = errors.New("silknet: message authentication failed")

const blockSize = 16

// ccm implements AES-CCM (RFC 3610 / NIST SP 800-38C) with a 13-byte nonce (L = 2).
// The Go standard library has no CCM mode, so it is built from the AES block cipher.
type ccm struct {
	block  cipher.Block
	tagLen int
}

func newCCM(block cipher.Block, tagLen int) (*ccm, error) {
	if block.BlockSize() != blockSize {
		return nil, errors.New("silknet: CCM requires a 128-bit block cipher")
	}
	if tagLen < 4 || tagLen > 16 || tagLen%2 != 0 {
		return nil, errors.New("silknet: invalid CCM tag length")
	}
	return &ccm{block: block, tagLen: tagLen}, nil
}

const nonceLen = 13
const lenFieldSize = 15 - nonceLen // L = 2 → messages up to 65535 bytes

// mac computes the CBC-MAC T over B0 ‖ encoded(aad) ‖ plaintext.
func (c *ccm) mac(nonce, plaintext, aad []byte) [blockSize]byte {
	var b0 [blockSize]byte
	flags := byte((c.tagLen-2)/2) << 3
	flags |= byte(lenFieldSize - 1)
	if len(aad) > 0 {
		flags |= 1 << 6
	}
	b0[0] = flags
	copy(b0[1:1+nonceLen], nonce)
	binary.BigEndian.PutUint16(b0[14:], uint16(len(plaintext)))

	var x [blockSize]byte
	c.block.Encrypt(x[:], b0[:])

	absorb := func(data []byte) {
		for len(data) > 0 {
			n := blockSize
			if len(data) < n {
				n = len(data)
			}
			for i := 0; i < n; i++ {
				x[i] ^= data[i]
			}
			// Remaining bytes of a partial block are XORed with zeros (implicit padding).
			c.block.Encrypt(x[:], x[:])
			data = data[n:]
		}
	}

	if len(aad) > 0 {
		// 0 < l(a) < 2^16 − 2^8: two-byte big-endian length prefix, then aad, zero padded.
		enc := make([]byte, 2+len(aad))
		binary.BigEndian.PutUint16(enc, uint16(len(aad)))
		copy(enc[2:], aad)
		absorb(enc)
	}
	absorb(plaintext)
	return x
}

// ctr XORs src with the CTR keystream starting at counter 1 and returns S0 (counter 0 block).
func (c *ccm) ctr(nonce, dst, src []byte) [blockSize]byte {
	var a, s [blockSize]byte
	a[0] = byte(lenFieldSize - 1)
	copy(a[1:1+nonceLen], nonce)
	var s0 [blockSize]byte
	c.block.Encrypt(s0[:], a[:])
	counter := uint16(1)
	for off := 0; off < len(src); off += blockSize {
		binary.BigEndian.PutUint16(a[14:], counter)
		c.block.Encrypt(s[:], a[:])
		end := off + blockSize
		if end > len(src) {
			end = len(src)
		}
		for i := off; i < end; i++ {
			dst[i] = src[i] ^ s[i-off]
		}
		counter++
	}
	return s0
}

// Seal encrypts and authenticates plaintext, returning ciphertext ‖ tag.
func (c *ccm) Seal(nonce, plaintext, aad []byte) ([]byte, error) {
	if len(nonce) != nonceLen {
		return nil, errors.New("silknet: CCM nonce must be 13 bytes")
	}
	if len(plaintext) > 0xFFFF || len(aad) >= 0xFF00 {
		return nil, errors.New("silknet: CCM input too long")
	}
	t := c.mac(nonce, plaintext, aad)
	out := make([]byte, len(plaintext)+c.tagLen)
	s0 := c.ctr(nonce, out[:len(plaintext)], plaintext)
	for i := 0; i < c.tagLen; i++ {
		out[len(plaintext)+i] = t[i] ^ s0[i]
	}
	return out, nil
}

// Open verifies and decrypts ciphertext ‖ tag. It fails closed: no plaintext is returned on error.
func (c *ccm) Open(nonce, sealed, aad []byte) ([]byte, error) {
	if len(nonce) != nonceLen {
		return nil, errors.New("silknet: CCM nonce must be 13 bytes")
	}
	if len(sealed) < c.tagLen {
		return nil, ErrAuth
	}
	ct := sealed[:len(sealed)-c.tagLen]
	tag := sealed[len(sealed)-c.tagLen:]
	pt := make([]byte, len(ct))
	s0 := c.ctr(nonce, pt, ct)
	t := c.mac(nonce, pt, aad)
	expected := make([]byte, c.tagLen)
	for i := range expected {
		expected[i] = t[i] ^ s0[i]
	}
	if subtle.ConstantTimeCompare(expected, tag) != 1 {
		for i := range pt {
			pt[i] = 0
		}
		return nil, ErrAuth
	}
	return pt, nil
}
