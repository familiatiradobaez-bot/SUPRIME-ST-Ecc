// Genera TOTP_ENCRYPTION_KEY: 32 bytes aleatorios en base64url.
// Se usa como clave AES-GCM para cifrar los secretos TOTP en D1.
//
// OJO AL ROTARLA: la clave va DENTRO del cifrado de cada secreto guardado. Si se
// cambia, los secretos ya cifrados dejan de descifrar y TODOS los usuarios con
// 2FA activar tienen que reconfigurarlo. No se rota por ELL; rotarla obliga a
// reescribir la columna, y para eso lo suyo es descifrar con la vieja y cifrar
// con la nueva.
import { randomBytes } from 'node:crypto';

const clave = randomBytes(32).toString('base64url');
console.log(clave);
console.error(`\n${clave.length} caracteres, ${Buffer.from(clave, 'base64url').length} bytes descifrados`);
console.error('Guarda esto en _SECRETS/cloudflare.env como TOTP_ENCRYPTION_KEY=...');
console.error('y ponlo como secreto del Worker con:  wrangler secret put TOTP_ENCRYPTION_KEY');
