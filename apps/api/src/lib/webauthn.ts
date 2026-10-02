// Verificación WebAuthn (passkeys) sin librerías externas.
//
// Qué hace y por qué está escrito así:
// - El servidor NUNCA confía en lo que dice el navegador: challenge propio de
//   un solo uso, origin y rpId comprobados, y verificación criptográfica de la
//   firma con WebCrypto.
// - Solo se acepta attestation 'none' (los autenticadores de plataforma —
//   Touch ID, Windows Hello, Android — no mandan cadena de confianza y es lo
//   que exige la especificación para ellos).
// - Se exige el flag UP (user present) siempre, y UV (user verified) cuando el
//   navegador lo Affirmó al crear la credencial.

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

// ── CBOR mínimo (lo justo para una clave COSE) ────────────────────────────
// Decodifica enteros, bytes y mapas de clave entera. Nada más se necesita y
// nada más se acepta: si aparece una etiqueta u otros tipos, se rechaza.
export function cborDecode(bytes: Uint8Array): Map<number, number | Uint8Array> {
  let offset = 0;

  function readUint(info: number): number {
    if (info < 24) return info;
    if (info === 24) return bytes[offset++];
    if (info === 25) { const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0); offset += 2; return v; }
    if (info === 26) { const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0); offset += 4; return v; }
    throw new Error('CBOR: entero no soportado');
  }

  function readValue(): number | Uint8Array {
    const initial = bytes[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === 0) return readUint(info);              // unsigned int
    if (major === 1) return -1 - readUint(info);         // negative int (COSE usa -1, -2, -3)
    if (major === 2) {                                   // byte string
      const len = readUint(info);
      const value = bytes.slice(offset, offset + len);
      offset += len;
      return value;
    }
    throw new Error('CBOR: tipo no soportado');
  }

  const initial = bytes[0];
  offset = 1; // el byte inicial ya se ha consumido: readUint lee desde aquí
  if ((initial >> 5) !== 5) throw new Error('CBOR: se esperaba un mapa');
  const mapInfo = initial & 0x1f;
  // Un mapa con 24 entradas o menos lleva el tamaño en el propio byte inicial
  // (info < 24). Solo a partir de ahí viene con bytes extra (24/25/26).
  if (mapInfo > 26) throw new Error('CBOR: tamaño de mapa no soportado');
  const entries = readUint(mapInfo);
  const map = new Map<number, number | Uint8Array>();
  for (let i = 0; i < entries; i++) {
    const keyMajor = bytes[offset] >> 5;
    if (keyMajor !== 0 && keyMajor !== 1) throw new Error('CBOR: clave de mapa no entera');
    const key = readValue() as number;
    map.set(key, readValue());
  }
  return map;
}

export type ParsedAuthData = {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attestedCredentialData?: { aaguid: Uint8Array; credentialId: Uint8Array; credentialPublicKey: Uint8Array };
};

export function parseAuthData(authData: Uint8Array): ParsedAuthData {
  if (authData.length < 37) throw new Error('authData demasiado corto');
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = view.getUint32(33);
  const parsed: ParsedAuthData = { rpIdHash, flags, signCount };

  // Bit 0x40 = AT (attested credential data presente).
  if ((flags & 0x40) === 0) return parsed;
  let offset = 37;
  const aaguid = authData.slice(offset, offset + 16);
  offset += 16;
  const len = new DataView(authData.buffer, authData.byteOffset + offset, 2).getUint16(0);
  offset += 2;
  const credentialId = authData.slice(offset, offset + len);
  offset += len;
  // El resto es la clave COSE: se pasa tal cual (el decoder la recorre solo).
  parsed.attestedCredentialData = { aaguid, credentialId, credentialPublicKey: authData.slice(offset) };
  return parsed;
}

export function coseToJwkParams(cose: Uint8Array): { alg: number; keyData: JsonWebKey } {
  const map = cborDecode(cose);
  const kty = map.get(1);
  const alg = map.get(3);
  if (typeof kty !== 'number' || typeof alg !== 'number') throw new Error('COSE incompleto');
  if (kty !== 2) throw new Error('Solo claves EC2 (kty=2)');

  if (alg === -7) {
    // ES256 (P-256) -> crv P-256, x/y son las coordenadas del punto.
    const x = map.get(-2);
    const y = map.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) throw new Error('COSE ES256 sin x/y');
    return { alg, keyData: { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y), ext: true } };
  }

  if (alg === -257) {
    // RS256 (RSA): x = modulus, y = exponent.
    const n = map.get(-1);
    const e = map.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new Error('COSE RS256 sin n/e');
    return { alg, keyData: { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e), ext: true } };
  }

  throw new Error(`Algoritmo no soportado: ${alg}`);
}

async function importPublicKey(keyData: JsonWebKey, alg: number): Promise<CryptoKey> {
  const params: EcKeyImportParams | RsaHashedImportParams =
    alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  return crypto.subtle.importKey('jwk', keyData as JsonWebKey, params, false, ['verify']);
}

async function sha256(data: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
}

export type VerifyRegistrationInput = {
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  requireUserVerification: boolean;
};

export async function verifyRegistration(input: VerifyRegistrationInput): Promise<{
  credentialId: string;
  publicKey: string;
  alg: number;
  backedUp: boolean;
  signCount: number;
}> {
  const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(input.response.clientDataJSON)));
  if (clientData.type !== 'webauthn.create') throw new Error('clientDataJSON.type inválido');
  if (clientData.challenge !== input.expectedChallenge) throw new Error('El desafío no coincide');
  if (clientData.origin !== input.expectedOrigin) throw new Error('Origin no permitido');

  const att = JSON.parse(new TextDecoder().decode(fromBase64Url(input.response.attestationObject)));
  // El campo se llama 'fmt' en la spec (no 'format').
  if (att.fmt !== 'none') throw new Error(`Formato de attestation no soportado: ${att.fmt}`);

  const authDataBytes = fromBase64Url(att.authData);
  const parsed = parseAuthData(authDataBytes);
  if (!parsed.attestedCredentialData) throw new Error('Falta attestedCredentialData');

  const expectedRpIdHash = await sha256(new TextEncoder().encode(input.expectedRpId));
  const rpIdHashOk = new Uint8Array(expectedRpIdHash);
  if (rpIdHashOk.length !== 32 || String(rpIdHashOk) !== String(parsed.rpIdHash)) {
    throw new Error('rpId no coincide con el dominio');
  }

  if ((parsed.flags & 0x01) === 0) throw new Error('Falta el flag UP (user present)');
  if (input.requireUserVerification && (parsed.flags & 0x04) === 0) {
    throw new Error('Falta el flag UV (user verified)');
  }

  const { alg, keyData } = coseToJwkParams(parsed.attestedCredentialData.credentialPublicKey);
  // La firma de 'none' cubre authData || SHA256(clientDataJSON).
  const clientHash = new Uint8Array(await sha256(fromBase64Url(input.response.clientDataJSON)));
  const signed = new Uint8Array(authDataBytes.length + clientHash.length);
  signed.set(authDataBytes, 0);
  signed.set(clientHash, authDataBytes.length);

  const key = await importPublicKey(keyData, alg);
  // El campo de la firma en el attestation object es 'sig' (no 'signature').
  const signature = fromBase64Url(att.sig);
  const ok = await crypto.subtle.verify(
    alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature as unknown as BufferSource,
    signed as unknown as BufferSource,
  );
  if (!ok) throw new Error('Firma de registro inválida');

  return {
    credentialId: toBase64Url(parsed.attestedCredentialData.credentialId),
    publicKey: toBase64Url(parsed.attestedCredentialData.credentialPublicKey),
    alg,
    backedUp: (parsed.flags & 0x08) !== 0,
    signCount: parsed.signCount,
  };
}

export async function verifyAssertion(input: {
  credentialId: string;
  storedPublicKey: string;
  storedAlg: number;
  storedSignCount: number;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  expectedUserId: string;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  requireUserVerification: boolean;
}): Promise<number> {
  const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(input.clientDataJSON)));
  if (clientData.type !== 'webauthn.get') throw new Error('clientDataJSON.type inválido');
  if (clientData.challenge !== input.expectedChallenge) throw new Error('El desafío no coincide');
  if (clientData.origin !== input.expectedOrigin) throw new Error('Origin no permitido');

  const authDataBytes = fromBase64Url(input.authenticatorData);
  const parsed = parseAuthData(authDataBytes);

  const expectedRpIdHash = new Uint8Array(await sha256(new TextEncoder().encode(input.expectedRpId)));
  if (String(expectedRpIdHash) !== String(parsed.rpIdHash)) throw new Error('rpId no coincide con el dominio');
  if ((parsed.flags & 0x01) === 0) throw new Error('Falta el flag UP (user present)');
  if (input.requireUserVerification && (parsed.flags & 0x04) === 0) {
    throw new Error('Falta el flag UV (user verified)');
  }

  // El userHandle que devuelve el autenticador debe ser el del usuario dueño
  // de la credencial; si viene, se comprueba. Evita ataques de mix-up.
  if (input.userHandle && input.userHandle !== input.expectedUserId) {
    throw new Error('userHandle no corresponde al usuario');
  }

  // Signal de clonación: si el autenticador tenía contador > 0 y no sube,
  // puede ser una copia. Se rechaza en vez de aceptar a ciegas.
  if (input.storedSignCount > 0 && parsed.signCount <= input.storedSignCount) {
    throw new Error('Posible passkey clonada (signCount no avanza)');
  }

  const { alg, keyData } = coseToJwkParams(fromBase64Url(input.storedPublicKey));
  if (alg !== input.storedAlg) throw new Error('El algoritmo no coincide con el registrado');

  const clientHash = new Uint8Array(await sha256(fromBase64Url(input.clientDataJSON)));
  const signed = new Uint8Array(authDataBytes.length + clientHash.length);
  signed.set(authDataBytes, 0);
  signed.set(clientHash, authDataBytes.length);

  const key = await importPublicKey(keyData, alg);
  const ok = await crypto.subtle.verify(
    alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
    key,
    fromBase64Url(input.signature) as unknown as BufferSource,
    signed as unknown as BufferSource,
  );
  if (!ok) throw new Error('Firma de autenticación inválida');

  return parsed.signCount;
}