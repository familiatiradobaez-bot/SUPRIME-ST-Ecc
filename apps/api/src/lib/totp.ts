// TOTP (RFC 4226/6238) con secreto base32 — compatible con Google Authenticator/Authy.
// El secreto se almacena en base32 (lo que espera el URI otpauth://) y se
// decodifica a bytes para el HMAC. HMAC-SHA1 síncrono propio (sin dependencias).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  while (output.length % 8 !== 0) {
    output += '=';
  }
  return output;
}

export function base32Decode(input: string): Uint8Array | null {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret(numBytes = 20): string {
  const array = new Uint8Array(numBytes);
  crypto.getRandomValues(array);
  // Sin padding `=`: la mayoría de apps lo toleran y el QR queda más limpio
  return base32Encode(array).replace(/=+$/, '');
}

function sha1(data: Uint8Array): Uint8Array {
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const val = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (val << 1) | (val >>> 31);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, h0, false);
  resultView.setUint32(4, h1, false);
  resultView.setUint32(8, h2, false);
  resultView.setUint32(12, h3, false);
  resultView.setUint32(16, h4, false);
  return result;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let keyBytes = key;

  if (keyBytes.length > blockSize) {
    keyBytes = sha1(keyBytes);
  }
  if (keyBytes.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(keyBytes);
    keyBytes = padded;
  }

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = keyBytes[i] ^ 0x36;
    opad[i] = keyBytes[i] ^ 0x5c;
  }

  const inner = sha1(concat(ipad, message));
  return sha1(concat(opad, inner));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

export function hotp(base32Secret: string, counter: number, digits = 6): string | null {
  const key = base32Decode(base32Secret);
  if (!key) return null;

  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  // Contador de 64 bits big-endian (los 4 primeros bytes quedan en 0)
  timeView.setUint32(0, Math.floor(counter / 0x100000000), false);
  timeView.setUint32(4, counter >>> 0, false);

  const hmacResult = hmacSha1(key, new Uint8Array(timeBuffer));
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function verifyTOTP(code: string, base32Secret: string, digits = 6, window = 1): boolean {
  return verifyTOTPWithCounter(code, base32Secret, digits, window).ok;
}

// Variante anti-replay: devuelve el contador aceptado para guardarlo (last_counter).
export function verifyTOTPWithCounter(
  code: string,
  base32Secret: string,
  digits = 6,
  window = 1
): { ok: boolean; counter: number } {
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { ok: false, counter: -1 };
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(base32Secret, timeStep + i, digits) === code) {
      return { ok: true, counter: timeStep + i };
    }
  }
  return { ok: false, counter: -1 };
}
