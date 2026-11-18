// Package mqtt is a small, dependency-free MQTT 3.1.1 client (OASIS standard) sufficient for
// subscribing to gateway uplinks: CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH (QoS 0/1),
// PUBACK, PINGREQ/PINGRESP and DISCONNECT.
package mqtt

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Control packet types (MQTT 3.1.1 §2.2.1).
const (
	CONNECT     byte = 1
	CONNACK     byte = 2
	PUBLISH     byte = 3
	PUBACK      byte = 4
	SUBSCRIBE   byte = 8
	SUBACK      byte = 9
	PINGREQ     byte = 12
	PINGRESP    byte = 13
	DISCONNECT  byte = 14
	maxRemaining      = 268_435_455 // 4-byte variable length limit
)

var ErrMalformed = errors.New("mqtt: malformed packet")

// Packet is a decoded control packet: fixed-header flags plus the raw remaining bytes.
type Packet struct {
	Type  byte
	Flags byte
	Body  []byte
}

// encodeLength writes the MQTT variable-length integer (7 bits per byte, MSB = continuation).
func encodeLength(n int) []byte {
	var out []byte
	for {
		b := byte(n % 128)
		n /= 128
		if n > 0 {
			b |= 0x80
		}
		out = append(out, b)
		if n == 0 {
			return out
		}
	}
}

func decodeLength(r io.ByteReader) (int, error) {
	mult, value := 1, 0
	for i := 0; i < 4; i++ {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		value += int(b&0x7F) * mult
		if b&0x80 == 0 {
			return value, nil
		}
		mult *= 128
	}
	return 0, ErrMalformed
}

func str(s string) []byte {
	out := make([]byte, 2+len(s))
	binary.BigEndian.PutUint16(out, uint16(len(s)))
	copy(out[2:], s)
	return out
}

// Encode serialises a packet with its fixed header.
func Encode(p Packet) []byte {
	out := []byte{p.Type<<4 | (p.Flags & 0x0F)}
	out = append(out, encodeLength(len(p.Body))...)
	return append(out, p.Body...)
}

// Read reads one complete packet from r.
func Read(r *bufio.Reader) (Packet, error) {
	h, err := r.ReadByte()
	if err != nil {
		return Packet{}, err
	}
	n, err := decodeLength(r)
	if err != nil {
		return Packet{}, err
	}
	if n > maxRemaining {
		return Packet{}, ErrMalformed
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return Packet{}, err
	}
	return Packet{Type: h >> 4, Flags: h & 0x0F, Body: body}, nil
}

// ConnectOptions for the CONNECT packet.
type ConnectOptions struct {
	ClientID     string
	Username     string
	Password     string
	KeepAliveSec uint16
	CleanSession bool
}

func Connect(o ConnectOptions) Packet {
	body := str("MQTT")
	body = append(body, 4) // protocol level 3.1.1
	var flags byte
	if o.CleanSession {
		flags |= 0x02
	}
	if o.Username != "" {
		flags |= 0x80
	}
	if o.Password != "" {
		flags |= 0x40
	}
	body = append(body, flags)
	body = binary.BigEndian.AppendUint16(body, o.KeepAliveSec)
	body = append(body, str(o.ClientID)...)
	if o.Username != "" {
		body = append(body, str(o.Username)...)
	}
	if o.Password != "" {
		body = append(body, str(o.Password)...)
	}
	return Packet{Type: CONNECT, Body: body}
}

// ConnackCode returns the CONNACK return code (0 = accepted).
func ConnackCode(p Packet) (byte, error) {
	if p.Type != CONNACK || len(p.Body) != 2 {
		return 0, ErrMalformed
	}
	return p.Body[1], nil
}

func Subscribe(packetID uint16, topic string, qos byte) Packet {
	body := binary.BigEndian.AppendUint16(nil, packetID)
	body = append(body, str(topic)...)
	body = append(body, qos&0x03)
	return Packet{Type: SUBSCRIBE, Flags: 0x02, Body: body} // reserved flags 0010 (§3.8.1)
}

// Message is an application message carried by PUBLISH.
type Message struct {
	Topic    string
	Payload  []byte
	QoS      byte
	PacketID uint16
	Retain   bool
	Dup      bool
}

func Publish(m Message) Packet {
	body := str(m.Topic)
	if m.QoS > 0 {
		body = binary.BigEndian.AppendUint16(body, m.PacketID)
	}
	body = append(body, m.Payload...)
	var flags byte = (m.QoS & 0x03) << 1
	if m.Retain {
		flags |= 0x01
	}
	if m.Dup {
		flags |= 0x08
	}
	return Packet{Type: PUBLISH, Flags: flags, Body: body}
}

func ParsePublish(p Packet) (Message, error) {
	if p.Type != PUBLISH || len(p.Body) < 2 {
		return Message{}, ErrMalformed
	}
	tl := int(binary.BigEndian.Uint16(p.Body))
	if len(p.Body) < 2+tl {
		return Message{}, ErrMalformed
	}
	m := Message{
		Topic:  string(p.Body[2 : 2+tl]),
		QoS:    (p.Flags >> 1) & 0x03,
		Retain: p.Flags&0x01 != 0,
		Dup:    p.Flags&0x08 != 0,
	}
	if m.QoS == 3 {
		return Message{}, fmt.Errorf("%w: QoS 3", ErrMalformed)
	}
	rest := p.Body[2+tl:]
	if m.QoS > 0 {
		if len(rest) < 2 {
			return Message{}, ErrMalformed
		}
		m.PacketID = binary.BigEndian.Uint16(rest)
		rest = rest[2:]
	}
	m.Payload = rest
	return m, nil
}

func PubAck(packetID uint16) Packet {
	return Packet{Type: PUBACK, Body: binary.BigEndian.AppendUint16(nil, packetID)}
}

func PingReq() Packet    { return Packet{Type: PINGREQ} }
func Disconnect() Packet { return Packet{Type: DISCONNECT} }
