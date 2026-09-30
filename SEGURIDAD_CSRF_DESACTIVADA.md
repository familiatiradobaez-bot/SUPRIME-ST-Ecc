# ✅ SEGURIDAD: CSRF REACTIVADO (2026-09-30)

**Estado:** 🟢 **PROTEGIDO** — este documento se conserva por historia.

> Antes de este cambio el texto de aquí decía que la API estaba *"vulnerable a CSRF"*. **No lo
> estaba.** Está reescrito abajo con lo que se comprobó de verdad.

## Qué pasó

El 2026-09-28 (commit `da4386f`) se desactivó el middleware de CSRF de `apps/api/src/app.ts` al ver
`403 FORBIDDEN - Invalid origin` en las peticiones de admin.

## Por qué se deactivate realmente (y no era CORS)

El middleware exigía un `Origin` válido **siempre**, también en peticiones que no venían de un
navegador. El propio `npm run smoke` usa `node fetch`, **que no manda cabecera `Origin`**, así que
el smoke se bloqueaba a sí mismo. Verificado:

```
POST /auth/login sin Origin  →  400/401  (llega al handler; NO es un 403)
```

O sea: **la protección bloqueaba a un cliente legítimo y no a un atacante.** Desactivarla no abrió
ningún agujero nuevo; dejó de existir una barrera que además estaba mal implementada.

## Por qué el riesgo era nulo aun con el middleware apagado

Verificado contra la API desplegada, no de teoría:

| Comprobación | Resultado |
|---|---|
| ¿La API lee la cookie para autenticar? | **No.** No hay ni un `getCookie` en todo `apps/api/src`. Todo va por `Authorization: Bearer` |
| `/admin/users` con solo `Cookie: session_token=...` | **401** |
| `POST /admin/products` con solo cookie | **401** |

La autenticación es un **Bearer token guardado en `localStorage`**. Un atacante en otro origen no
puede leer ese `localStorage` (misma política de origen) ni lograr que el navegador lo añada a una
petición: lo añade el JS de `suprime.xyz`, no el navegador. Ese es el motivo por el que el CSRF, en
esta API, **no aplica**: no hay credenciales que el navegador adjunte solo.

La cookie `session_token` que sí se emite es `HttpOnly` + `Secure` + **`SameSite=Strict`**, o sea
que ni siquiera viaja en una petición de otro sitio.

## Qué se ha hecho (2026-09-30)

El middleware vuelve a estar activo, con la regla correcta:

```
GET / HEAD / OPTIONS  →  siempre pasan
POST / PUT / DELETE:
  · sin Origin ni Referer  →  pasa (cliente no-navegador: smoke, curl, backend)
  · con Origin/Referer     →  se valida contra la allowlist; si no cuadra, 403 FORBIDDEN
```

Validar el origen **solo cuando hay origen que validar** es lo que corrige el fallo original: un
cliente servidor-a-servidor no tiene Origin porque no es un navegador, y ése no es un ataque.

Se mantiene la barrera porque es gratuita y protege el día que alguien meta un endpoint que sí use
la cookie para autenticar.

Verificado en producción tras el despliegue:

| Caso | Resultado |
|---|---|
| `POST` sin `Origin` (el smoke) | 400 · **no bloquea** |
| `POST` con `Origin: https://suprime.xyz` | 400 · **no bloquea** |
| `POST` con `Origin: https://evil.example` | **403 `FORBIDDEN`** |
| `GET /health` con `Origin: https://evil.example` | **200** (GET nunca se bloquea) |

## Cómo no volver a desactivarlo

Hay **cuatro checks del smoke** dedicados a esto (`npm run smoke`, sección `== CSRF ==`). Si algún día
salen `403 Invalid origin` en la API, el sitio está bien y lo que falla es un cliente que no manda
`Origin`; la respuesta es añadir ese origen a la allowlist de `app.ts`, **no** desactivar el
middleware.

```
PASS CSRF: POST sin Origin (servidor a servidor) NO se bloquea
PASS CSRF: POST con Origin de atacante 403 FORBIDDEN
PASS CSRF: POST con el Origin del front NO se bloquea
PASS CSRF: GET no se bloquea nunca
```

## Deuda menor que queda aquí

- La allowlist de `allowedOrigins` incluye las URLs de desarrollo (ngrok, trycloudflare, IPs locales).
  No son un riesgo en producción (`*.ngrok-free.dev` y `*.trycloudflare.com` se aceptan por
  comodidad), pero se pueden borrar cuando el proyecto deje de usarse para desarrollo.
- Sigue sin estar la cabecera `Origin` en la respuesta de error del 403, que es lo que pediría un
  diagnóstico mejor. Es cosmético.
