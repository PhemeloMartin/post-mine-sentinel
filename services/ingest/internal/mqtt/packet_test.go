package mqtt

import (
	"bufio"
	"bytes"
	"testing"
)

func TestVariableLengthEncoding(t *testing.T) {
	// Boundary values from MQTT 3.1.1 §2.2.3 table 2.4.
	cases := map[int][]byte{
		0:           {0x00},
		127:         {0x7F},
		128:         {0x80, 0x01},
		16_383:      {0xFF, 0x7F},
		16_384:      {0x80, 0x80, 0x01},
		2_097_151:   {0xFF, 0xFF, 0x7F},
		268_435_455: {0xFF, 0xFF, 0xFF, 0x7F},
	}
	for n, want := range cases {
		got := encodeLength(n)
		if !bytes.Equal(got, want) {
			t.Fatalf("encode %d: got %x want %x", n, got, want)
		}
		back, err := decodeLength(bufio.NewReader(bytes.NewReader(got)))
		if err != nil || back != n {
			t.Fatalf("decode %x: got %d (%v)", got, back, err)
		}
	}
	if _, err := decodeLength(bufio.NewReader(bytes.NewReader([]byte{0xFF, 0xFF, 0xFF, 0xFF, 0x01}))); err == nil {
		t.Fatal("5-byte length must be rejected")
	}
}

func TestConnectPacketLayout(t *testing.T) {
	raw := Encode(Connect(ConnectOptions{ClientID: "ingest-1", Username: "u", Password: "p", KeepAliveSec: 30, CleanSession: true}))
	if raw[0] != 0x10 {
		t.Fatalf("fixed header %x", raw[0])
	}
	// variable header: 00 04 'M' 'Q' 'T' 'T' 04 flags(0xC2) 00 1E
	if !bytes.Equal(raw[2:12], []byte{0x00, 0x04, 'M', 'Q', 'T', 'T', 0x04, 0xC2, 0x00, 0x1E}) {
		t.Fatalf("variable header %x", raw[2:12])
	}
}

func TestPublishRoundTripQoS1(t *testing.T) {
	in := Message{Topic: "silknet/ZA-NW-002/up", Payload: []byte(`{"frame":"AA=="}`), QoS: 1, PacketID: 4242}
	p, err := Read(bufio.NewReader(bytes.NewReader(Encode(Publish(in)))))
	if err != nil {
		t.Fatal(err)
	}
	out, err := ParsePublish(p)
	if err != nil {
		t.Fatal(err)
	}
	if out.Topic != in.Topic || out.PacketID != in.PacketID || out.QoS != 1 || !bytes.Equal(out.Payload, in.Payload) {
		t.Fatalf("round trip mismatch: %+v", out)
	}
}

func TestSubscribeHasReservedFlags(t *testing.T) {
	raw := Encode(Subscribe(7, "silknet/+/up", 1))
	if raw[0] != 0x82 {
		t.Fatalf("SUBSCRIBE fixed header must be 0x82, got %x", raw[0])
	}
}

func TestMalformedPublishRejected(t *testing.T) {
	for _, body := range [][]byte{{0x00}, {0x00, 0x09, 'a'}} {
		if _, err := ParsePublish(Packet{Type: PUBLISH, Body: body}); err == nil {
			t.Fatalf("expected error for %x", body)
		}
	}
	if _, err := ParsePublish(Packet{Type: PUBLISH, Flags: 0x06, Body: []byte{0x00, 0x01, 'a'}}); err == nil {
		t.Fatal("QoS 3 must be rejected")
	}
}
