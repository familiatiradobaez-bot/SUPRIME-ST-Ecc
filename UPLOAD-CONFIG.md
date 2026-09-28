# Configuración del Sistema de Subida de Imágenes (ImageKit)

Flujo global: navegador → Worker (`POST /api/v1/upload/imagekit`) → ImageKit.
La private key nunca sale del servidor. El front no necesita keys.

## Dónde colocar las credenciales

### Producción: secreto del Worker (obligatorio)

```bash
wrangler secret put IMAGEKIT_PRIVATE_KEY
```

Verificar: `wrangler secret list` debe mostrar `IMAGEKIT_PRIVATE_KEY`.

### Variables públicas (ya commiteadas en `wrangler.toml`)

```toml
[vars]
IMAGEKIT_PUBLIC_KEY = "public_..."
IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/..."
```

### Desarrollo local

Añade a `.dev.vars` en la raíz (no commitear, está en `.gitignore`):

```env
IMAGEKIT_PRIVATE_KEY=private_...
```

## Cómo obtener las credenciales

1. Ve a https://imagekit.io/ y crea cuenta / inicia sesión
2. Dashboard → Developers → API Keys
3. Copia: Private key, Public key y URL-endpoint

## Endpoint

### POST /api/v1/upload/imagekit

Request:

```json
{
  "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
  "filename": "mi-imagen.png"
}
```

Response:

```json
{
  "data": {
    "url": "https://ik.imagekit.io/.../products/mi-imagen.png",
    "display_url": "https://ik.imagekit.io/.../tr:w-400/...",
    "fileId": "...",
    "name": "mi-imagen.png",
    "filePath": "/products/mi-imagen.png"
  }
}
```

Errores: `SERVER_CONFIG_ERROR` (falta private key), `INVALID_INPUT`,
`FILE_TOO_LARGE` (>5MB), `INVALID_TYPE` (solo JPEG/PNG/GIF/WebP),
`RATE_LIMIT_EXCEEDED` (20 subidas / 15 min por IP), `UPLOAD_FAILED`.

### GET /api/v1/upload/images (galería, requiere admin)

Lista lo subido en `/products` para reutilizar sin resubir.
Requiere `Authorization: Bearer <token>` de `role-admin`/`role-owner`/`role-stock-manager`.

Response:

```json
{
  "data": [
    { "fileId": "...", "name": "...", "url": "https://ik.imagekit.io/...", "thumbnail": "https://...", "filePath": "/products/...", "size": 1234 }
  ]
}
```

## Seguridad implementada

- La private key nunca se expone al frontend
- Rate limiting de 20 subidas por 15 minutos por IP
- Validación de tipos de archivo (JPEG, PNG, GIF, WebP)
- Validación de tamaño máximo (5MB)
- Validación de URLs manuales (`POST /upload/validate-url`)
- Todas las subidas pasan por el servidor

## Nota: ruta ImgBB eliminada

La antigua `POST /upload/imgbb` se eliminó (ImgBB devolvía `code 103 forbidden`
para estas keys). El flujo global es ImageKit.
