/**
 * Caja de cifrado para secretos en reposo: AES-GCM con Web Crypto.
 *
 * POR QUE ESTO EXISTE
 *
 * Los secretos TOTP (la semilla del 2FA) se guardaban en D1 EN CLARO. Eso
 * significa que cualquiera que se llevase la base de datos — un backup, una
 * configuración mal puesta, una inyección SQL en cualquier otro endpoint, o
 * simplemente alguien con acceso a la consola de Cloudflare — se llevaría
 * también la semilla del segundo factor de TODOS los usuarios. Con esa semilla
 * el atacante genera códigos válidos para siempre, sin necesitar contraseñas y
 * sin necesitar el segundo factor. Es el peor dato que se puede filtrar de esta
 * base de datos, y estaba en texto plano.
 *
 * Cifrarlo con una clave que vive en un secreto del Worker (no en D1) hace que
 * un volcado de la base no sirva para nada: sin la clave, esas filas son ruido.
 *
 * FORMATO EN LA COLUMNA
 *
 *   enc1:<iv base64url>:<cifrado base64url>
 *
 * El prefijo `enc1` es lo que permite migrar sin romper a nadie: los secretos ya
 * guardados en claro NO lo llevan, así que se distinguen solos y se migran
 * perezosos la primera vez que el usuario los usa con éxito. El formato antiguo
 * (base32 de mayúsculas, o hex de 64 caracteres heredado) nunca empieza por
 * `enc1`, así que no hay ambigüedad posible.
 *
 * NUNCA se cifra la contraseña ni nada que se compare: esto es para datos que
 * hay que poder recuperar, no verificar.
 */

/** Prefijo que marca un valor cifrado por esta versión. */
const PREFIJO = 'enc1:';

function importarClave(claveB64Url: string): Promise<CryptoKey> {
  // La clave son 32 bytes en base64url. Web Crypto no acepta base64url, asi que
  // se pasa a base64 Adding padding antes de decodificar.
  const b64 = claveB64Url.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error(`TOTP_ENCRYPTION_KEY debe decodificar a 32 bytes; van ${bytes.length}`);
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const aBase64Url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const deBase64Url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
};

/** ¿Este valor de la columna está cifrado, o es un secreto antiguo en claro? */
export const estaCifrado = (valor: string | null | undefined): boolean =>
  typeof valor === 'string' && valor.startsWith(PREFIJO);

/**
 * Cifra un secreto. Devuelve el valor listo para la columna.
 * @throws si la clave no está configurada, que es preferible a guardar en claro
 *         sin avisar: fallar aquí es visible, guardar en claro no.
 */
export async function cifrarSecreto(claro: string, claveB64Url: string | undefined): Promise<string> {
  if (!claveB64Url) {
    throw new Error('TOTP_ENCRYPTION_KEY no configurada: no se puede cifrar el secreto TOTP');
  }
  const clave = await importarClave(claveB64Url);
  // IV aleatorio de 96 bits, que es el tamaño que espera AES-GCM. Se genera
  // nuevo en cada cifrado: reutilizarlo con la misma clave rompería el GCM.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    clave,
    new TextEncoder().encode(claro),
  );
  return `${PREFIJO}${aBase64Url(iv.buffer)}:${aBase64Url(cifrado)}`;
}

/**
 * Descifra un secreto. Si el valor NO lleva el prefijo, se devuelve tal cual:
 * es un secreto antiguo en claro y hay que seguir aceptándolo.
 */
export async function descifrarSecreto(valor: string, claveB64Url: string | undefined): Promise<string> {
  if (!estaCifrado(valor)) return valor;
  if (!claveB64Url) {
    // Prefijo presente pero sin clave: o no se ha desplegado el secreto, o se ha
    // desplegado con otra clave. En cualquier caso NO se cae al secreto en
    // claro: sería validar contra basura. Se lanza para que se vea.
    throw new Error('el secreto TOTP está cifrado pero TOTP_ENCRYPTION_KEY no está configurada');
  }
  const partes = valor.slice(PREFIJO.length).split(':');
  if (partes.length !== 2) throw new Error('formato cifrado inválido en user_totp.secret');
  const clave = await importarClave(claveB64Url);
  try {
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64Url(partes[0]) as unknown as BufferSource },
      clave,
      deBase64Url(partes[1]) as unknown as BufferSource,
    );
    return new TextDecoder().decode(claro);
  } catch {
    // GCM verifica la integridad: si falla, la clave no es la de este valor.
    throw new Error('no se puede descifrar el secreto TOTP: TOTP_ENCRYPTION_KEY no corresponde');
  }
}
