package silknet

import (
	"crypto/aes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// Frame types (protocol/SILKNET.md §2).
const (
	TypeHeartbeat byte = 0
	TypeDetection byte = 1
	TypePIR       byte = 2
	TypeTamper    byte = 3
	TypeBenign    byte = 4
	TypeAck       byte = 5
	TypeBeacon    byte = 6
)

const (
	Version    = 1
	HeaderLen  = 10
	MICLen     = 8
	PayloadLen = 14
	FrameLen   = HeaderLen + PayloadLen + MICLen
)

// Classes indexed by class_id.
var Classes = [...]string{"background", "footsteps", "digging", "machinery", "vehicle", "animal", "blast"}

var (
	ErrShort       = errors.New("silknet: frame too short")
	ErrVersion     = errors.New("silknet: unsupported version")
	ErrLength      = errors.New("silknet: length does not match frame type")
	ErrBadClass    = errors.New("silknet: unknown class id")
	ErrUnknownSite = errors.New("silknet: no key for site")
)

// Header is the cleartext 10-byte frame header.
type Header struct {
	Type    byte
	Flags   byte
	SiteID  uint16
	NodeID  uint16
	Counter uint32
}

// Hops returns the relay hop count carried in flags bits 2..4.
func (h Header) Hops() int { return int(h.Flags>>2) & 0x07 }

// Detection is the decoded 14-byte payload.
type Detection struct {
	WindowStart uint32
	ClassID     byte
	PThreatU8   byte
	SNRdB       int8
	ArrivalMs   uint16
	BatteryPct  byte
	Status      byte
}

func (d Detection) PThreat() float64 { return float64(d.PThreatU8) / 255.0 }
func (d Detection) Class() string    { return Classes[d.ClassID] }

// DeriveNodeKey: K_node = HMAC-SHA256(K_site, "silknet-v1" ‖ site ‖ node)[0:16].
func DeriveNodeKey(siteKey []byte, siteID, nodeID uint16) []byte {
	m := hmac.New(sha256.New, siteKey)
	m.Write([]byte("silknet-v1"))
	var ids [4]byte
	binary.BigEndian.PutUint16(ids[0:], siteID)
	binary.BigEndian.PutUint16(ids[2:], nodeID)
	m.Write(ids[:])
	return m.Sum(nil)[:16]
}

// Nonce builds the 13-byte CCM nonce: site ‖ node ‖ counter ‖ direction ‖ 0⁴.
func Nonce(siteID, nodeID uint16, counter uint32, direction byte) []byte {
	n := make([]byte, nonceLen)
	binary.BigEndian.PutUint16(n[0:], siteID)
	binary.BigEndian.PutUint16(n[2:], nodeID)
	binary.BigEndian.PutUint32(n[4:], counter)
	n[8] = direction
	return n
}

// ParseHeader validates the version and returns the cleartext header.
func ParseHeader(frame []byte) (Header, error) {
	if len(frame) < HeaderLen+MICLen {
		return Header{}, ErrShort
	}
	if frame[0]>>4 != Version {
		return Header{}, ErrVersion
	}
	return Header{
		Type:    frame[0] & 0x0F,
		Flags:   frame[1],
		SiteID:  binary.BigEndian.Uint16(frame[2:]),
		NodeID:  binary.BigEndian.Uint16(frame[4:]),
		Counter: binary.BigEndian.Uint32(frame[6:]),
	}, nil
}

func aad(frame []byte) []byte {
	// The flags byte (hop count) is mutable in transit and therefore excluded.
	a := make([]byte, 0, HeaderLen-1)
	a = append(a, frame[0])
	return append(a, frame[2:HeaderLen]...)
}

// Open authenticates and decrypts a frame using the per-node key derived from the site key.
func Open(frame []byte, siteKey func(siteID uint16) ([]byte, bool)) (Header, []byte, error) {
	h, err := ParseHeader(frame)
	if err != nil {
		return h, nil, err
	}
	expected := HeaderLen + PayloadLen + MICLen
	if h.Type == TypeAck {
		expected = HeaderLen + MICLen
	}
	if len(frame) != expected {
		return h, nil, ErrLength
	}
	sk, ok := siteKey(h.SiteID)
	if !ok {
		return h, nil, ErrUnknownSite
	}
	block, err := aes.NewCipher(DeriveNodeKey(sk, h.SiteID, h.NodeID))
	if err != nil {
		return h, nil, err
	}
	c, err := newCCM(block, MICLen)
	if err != nil {
		return h, nil, err
	}
	pt, err := c.Open(Nonce(h.SiteID, h.NodeID, h.Counter, 0), frame[HeaderLen:], aad(frame))
	return h, pt, err
}

// Seal builds a complete frame (used by tests and the field simulator).
func Seal(h Header, payload, nodeKey []byte) ([]byte, error) {
	frame := make([]byte, HeaderLen, HeaderLen+len(payload)+MICLen)
	frame[0] = Version<<4 | (h.Type & 0x0F)
	frame[1] = h.Flags
	binary.BigEndian.PutUint16(frame[2:], h.SiteID)
	binary.BigEndian.PutUint16(frame[4:], h.NodeID)
	binary.BigEndian.PutUint32(frame[6:], h.Counter)
	block, err := aes.NewCipher(nodeKey)
	if err != nil {
		return nil, err
	}
	c, err := newCCM(block, MICLen)
	if err != nil {
		return nil, err
	}
	sealed, err := c.Seal(Nonce(h.SiteID, h.NodeID, h.Counter, 0), payload, aad(frame))
	if err != nil {
		return nil, err
	}
	return append(frame, sealed...), nil
}

// ParseDetection decodes the 14-byte payload.
func ParseDetection(p []byte) (Detection, error) {
	if len(p) != PayloadLen {
		return Detection{}, ErrLength
	}
	d := Detection{
		WindowStart: binary.BigEndian.Uint32(p[0:]),
		ClassID:     p[4],
		PThreatU8:   p[5],
		SNRdB:       int8(p[6]),
		ArrivalMs:   binary.BigEndian.Uint16(p[7:]),
		BatteryPct:  p[9],
		Status:      p[10],
	}
	if int(d.ClassID) >= len(Classes) {
		return d, ErrBadClass
	}
	if d.ArrivalMs > 4000 || d.BatteryPct > 100 {
		return d, fmt.Errorf("silknet: field out of range (arrival=%d battery=%d)", d.ArrivalMs, d.BatteryPct)
	}
	return d, nil
}

// PackDetection is the inverse of ParseDetection.
func PackDetection(d Detection) []byte {
	p := make([]byte, PayloadLen)
	binary.BigEndian.PutUint32(p[0:], d.WindowStart)
	p[4] = d.ClassID
	p[5] = d.PThreatU8
	p[6] = byte(d.SNRdB)
	binary.BigEndian.PutUint16(p[7:], d.ArrivalMs)
	p[9] = d.BatteryPct
	p[10] = d.Status
	return p
}

// QuantiseP converts a probability to the 8-bit wire format.
func QuantiseP(p float64) byte { return byte(math.Round(math.Max(0, math.Min(1, p)) * 255)) }
