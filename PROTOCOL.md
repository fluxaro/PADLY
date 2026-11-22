# Padly Protocol v1 (all integers little-endian)

## Inner message (before encryption)
Header, 8 bytes: ver u8 (=1) | type u8 | seq u16 | ts u32 (sender ms, wraps)
Types and payloads:
- 0x01 STATE (16 bytes): buttons u32 | lx i16 | ly i16 | rx i16 | ry i16 | lt u8 | rt u8 | flags u16 (reserved, 0)
- 0x02 PING: no payload
- 0x03 PONG: echoed_seq u16 | echoed_ts u32
- 0x10 HELLO (phone->PC): phone_salt 8 bytes | name_len u8 | name utf8
- 0x11 HELLO_ACK (PC->phone): pc_salt 8 bytes | accepted u8 | target u8 (0=xbox,1=ds4) | pc_name_len u8 | pc_name utf8
- 0x20 RUMBLE (PC->phone): strong u8 | weak u8 | duration_ms u16
- 0x30 BYE: no payload

## Button bits (buttons u32)
A0 B1 X2 Y3 LB4 RB5 BACK6 START7 HOME8 L3=9 R3=10 UP11 DOWN12 LEFT13 RIGHT14 SHARE15

## Axis rules
Sticks: i16 -32768..32767, up is NEGATIVE y (evdev convention). Triggers: u8 0..255. Deadzone is applied by the phone.

## Encryption (ChaCha20-Poly1305, 16-byte tag)
- pairing_key: 32 random bytes, shown in the PC app's QR code, stored by the phone after scanning.
- Handshake frames (HELLO, HELLO_ACK) on the wire: 0x01 | nonce(12 random bytes) | ciphertext+tag, key = pairing_key, AAD = the 0x01 byte.
- Session key = HKDF-SHA256(ikm=pairing_key, salt=phone_salt||pc_salt, info="padly-session-v1", 32 bytes).
- Session frames on the wire: 0x02 | counter u32 | ciphertext+tag. Nonce (12 bytes) = direction u8 (0 phone->PC, 1 PC->phone) | 0,0,0 | counter u32 | 0,0,0,0. AAD = the first 5 bytes. Counter starts at 0 per session, increments per frame. The receiver drops any frame whose counter is not greater than the last accepted one.

## Pairing QR payload (UTF-8 string)
padly://pair?v=1&id=<pc_id>&name=<urlencoded>&key=<base64url 32 bytes>&host=<ip>&port=<udp_port>&tcp=<tcp_port>&bt=<rfcomm_uuid>

## Transports
- WiFi/USB-tethering: UDP datagram = one wire frame.
- USB adb-reverse and Bluetooth RFCOMM: byte stream; each wire frame is prefixed with u16 length.
- STATE is a full snapshot, sent on change and at least every 100 ms as a heartbeat. PC zeroes all input if nothing arrives for 300 ms.
- PING every 1 s; PONG gives RTT. Default ports: UDP 47820, TCP 47821.

## Discovery (optional)
mDNS service `_padly._udp` with TXT `id=<pc_id>`
The PC app can advertise this mDNS service on local Wi-Fi to allow the phone to automatically track and update the PC's IP address when it changes between sessions.
