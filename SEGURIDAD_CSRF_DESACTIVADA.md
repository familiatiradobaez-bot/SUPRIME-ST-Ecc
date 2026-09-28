# ⚠️ SEGURIDAD: CSRF DESACTIVADA TEMPORALMENTE

**Fecha:** 2026-09-28
**Estado:** 🔴 CSRF PROTECTION DISABLED

## Resumen

El middleware de protección CSRF en `apps/api/src/app.ts` ha sido **desactivado temporalmente** para resolver problemas de CORS que bloqueaban las peticiones de administración.

## Problema original

- Las peticiones de admin (crear, editar, borrar productos) fallaban con `403 FORBIDDEN - Invalid origin`
- El middleware CSRF bloqueaba las peticiones porque el origen `https://suprime.xyz` no coincidía con la lista de permitidos
- Se intentó añadir `https://api.suprime.xyz` a `allowedOrigins` pero el problema persistió

## Solución aplicada

- **Commit:** `da4386f` — "fix: desactivar CSRF temporalmente hasta resolver CORS"
- **Worker version:** `fb3ef422-6961-4e1a-97cb-04d7b410691a`
- **Archivo modificado:** `apps/api/src/app.ts`

## Riesgos de seguridad

⚠️ **Con CSRF desactivado, la API es vulnerable a ataques Cross-Site Request Forgery.**

Un atacante podría:
- Crear, editar o borrar productos sin autorización
- Modificar roles de usuarios
- Realizar acciones administrativas en nombre de un usuario autenticado

## Pasos para reactivar

1. **Identificar la causa raíz del problema de CORS:**
   - Verificar qué origen se envía realmente en las peticiones
   - Revisar la configuración de `allowedOrigins` en `app.ts`
   - Considerar usar un enfoque de validación de origen más robusto

2. **Reactivar el middleware CSRF:**
   - Descomentar el bloque `api.use('*', ...)` en `apps/api/src/app.ts`
   - Asegurarse de que `allowedOrigins` incluya todos los orígenes legítimos

3. **Probar exhaustivamente:**
   - Verificar que las peticiones de admin funcionen correctamente
   - Confirmar que los ataques CSRF sean bloqueados
   - Probar desde todos los dominios permitidos

4. **Desplegar y verificar:**
   - `npm run build:api`
   - `npx wrangler deploy`
   - Verificar en producción que todo funcione correctamente

## Notas adicionales

- El problema original podría estar relacionado con cómo Cloudflare Pages maneja los headers de origen
- Considerar usar `Access-Control-Allow-Origin: *` para desarrollo y restringir en producción
- Evaluar si el middleware CSRF es necesario dado que se usa autenticación por token

---

**Recordatorio creado automáticamente por OpenCode**
