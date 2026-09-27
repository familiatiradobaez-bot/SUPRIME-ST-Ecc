# Configuracion del Sistema de Subida de Imagenes

## Donde colocar la API Key de ImgBB

**IMPORTANTE:** La API Key de ImgBB NUNCA debe estar en el codigo del frontend.

### Opcion 1: Variables de entorno en wrangler.toml (Recomendado para produccion)

Edita el archivo `wrangler.toml` en la raiz del proyecto:

```toml
[env.production]
IMGBB_API_KEY = "tu_api_key_aqui"

[env.preview]
IMGBB_API_KEY = "tu_api_key_aqui"
```

### Opcion 2: Secretos en wrangler (Mas seguro - Recomodado)

Usa el gestor de secretos de Wrangler:

```bash
wrangler secret put IMGBB_API_KEY
```

Esto pedira que ingreses la API Key y la almacenara de forma segura.

### Opcion 3: Archivo .env.local (Solo desarrollo local)

Crea un archivo `.env.local` en la raiz del proyecto:

```env
IMGBB_API_KEY=tu_api_key_aqui
```

**Nota:** Asegurate de que `.env.local` este en tu `.gitignore`.

### Como obtener una API Key de ImgBB

1. Ve a https://imgbb.com/
2. Crea una cuenta o inicia sesion
3. Ve a https://api.imgbb.com/ (seccion API)
4. Copia tu API Key
5. Colocala en una de las opciones anteriores

---

## Estructura del Sistema

```
Frontend (React)                    Backend (Hono)              ImgBB
     |                                  |                         |
     |  1. Usuario selecciona imagen    |                         |
     |--------------------------------->|                         |
     |                                  |  2. Servidor recibe     |
     |                                  |     imagen (sin key)    |
     |                                  |                         |
     |                                  |  3. Servidor sube a     |
     |                                  |     ImgBB con API Key   |
     |                                  |------------------------>|
     |                                  |                         |
     |                                  |  4. ImgBB responde con  |
     |                                  |     URL publica         |
     |                                  |<------------------------|
     |                                  |                         |
     |  5. Servidor devuelve URL       |                         |
     |<---------------------------------|                         |
     |                                  |                         |
     |  6. Usuario ve la URL y guarda   |                         |
```

---

## Endpoints del Sistema

### POST /api/v1/upload/imgbb
Sube una imagen a ImgBB usando la API Key del servidor.

**Request:**
```json
{
  "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
  "filename": "mi-imagen.png"
}
```

**Response:**
```json
{
  "data": {
    "url": "https://i.ibb.co/...",
    "display_url": "https://i.ibb.co/...",
    "delete_url": "https://imgbb.com/...",
    "width": 800,
    "height": 600,
    "size": 12345
  }
}
```

### POST /api/v1/upload/validate-url
Valida una URL de imagen ingresada manualmente.

**Request:**
```json
{
  "url": "https://ejemplo.com/imagen.jpg"
}
```

**Response:**
```json
{
  "data": {
    "valid": true,
    "url": "https://ejemplo.com/imagen.jpg"
  }
}
```

---

## Seguridad Implementada

- La API Key NUNCA se expone al frontend
- Rate limiting de 20 subidas por 15 minutos por IP
- Validacion de tipos de archivo (JPEG, PNG, GIF, WebP)
- Validacion de tamano maximo (5MB)
- Validacion de URLs manuales
- Todas las solicitudes pasan por el servidor

---

## Rate Limiting

- **Limite:** 20 subidas por IP
- **Ventana:** 15 minutos
- **Respuesta al exceder:** 429 Too Many Requests
