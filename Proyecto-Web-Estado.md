# Proyecto Web E-commerce

> Documento de arquitectura base y registro de decisiones. Estado: e-commerce funcional con auth real, checkout conectado a API y 6 productos de prueba.

## 1. Objetivos y decisiones técnicas

- **Frontend:** React + Vite + TypeScript.
- **Backend:** Cloudflare Workers + Hono + TypeScript.
- **Persistencia local:** SQLite/D1 local mediante Wrangler y el mismo esquema SQL.
- **Persistencia futura:** Cloudflare D1 como base de datos nativa del runtime.
- **Validación:** Zod en los límites de la aplicación: HTTP, formularios y variables de entorno.
- **Autenticación:** sesiones seguras con cookies `httpOnly`; contraseña con Argon2id; Google OAuth 2.0.
- **RBAC:** permisos derivados del rol, nunca de una comprobación dispersa de nombres de usuario.
- **Imágenes:** únicamente URLs almacenadas como texto (`image_url`); no se guardan binarios en el servidor.
- **API:** REST versionada bajo `/api/v1`.

La regla principal es que `src/index.ts` solo crea la app y registra rutas. El dominio no conoce Hono, D1 ni React.

## 2. Estructura recomendada

```text
ecommerce/
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ index.ts                  # Solo composición y export del Worker
│  │     ├─ app.ts                    # Instancia/configuración de Hono
│  │     ├─ config/env.ts             # Variables validadas con Zod
│  │     ├─ middleware/               # Auth, errores, CORS, logging
│  │     ├─ routes/index.ts           # Registro de módulos HTTP
│  │     ├─ modules/
│  │     │  ├─ auth/
│  │     │  │  ├─ auth.routes.ts
│  │     │  │  ├─ auth.controller.ts
│  │     │  │  ├─ auth.service.ts
│  │     │  │  ├─ auth.schemas.ts
│  │     │  │  └─ auth.repository.ts
│  │     │  ├─ catalog/
│  │     │  │  ├─ catalog.routes.ts
│  │     │  │  ├─ catalog.controller.ts
│  │     │  │  ├─ catalog.service.ts
│  │     │  │  ├─ catalog.schemas.ts
│  │     │  │  └─ catalog.repository.ts
│  │     │  ├─ inventory/             # Stock y precios
│  │     │  ├─ departments/           # Departamentos y subdepartamentos
│  │     │  └─ admin/                 # Casos de uso administrativos
│  │     ├─ domain/                   # Entidades, value objects y puertos
│  │     └─ infrastructure/
│  │        ├─ db/
│  │        │  ├─ schema.ts
│  │        │  ├─ client.ts
│  │        │  └─ migrations/
│  │        └─ repositories/          # D1/local implementan puertos
│  └─ web/
│     └─ src/
│        ├─ main.tsx                  # Montaje de React
│        ├─ app/App.tsx               # Composición de la app
│        ├─ app/router.tsx
│        ├─ components/ui/            # Button, Input, Modal, DataTable
│        ├─ components/layout/        # Shell, Header, Sidebar
│        ├─ features/catalog/         # UI y hooks del catálogo
│        ├─ features/admin/           # Inventario, productos, categorías
│        ├─ features/auth/
│        ├─ lib/api-client.ts
│        └─ styles/tokens.css
├─ packages/
│  ├─ contracts/                      # DTOs y esquemas Zod compartidos
│  └─ config/                         # tsconfig, eslint y prettier
├─ db/
│  ├─ seed.ts
│  └─ local.sqlite                    # Ignorado por Git
├─ .env.example
├─ package.json
└─ README.md
```

Los módulos nuevos seguirán el flujo `route -> controller -> service -> repository`. El scaffold actual expone salud y catálogo; las consultas D1 están aisladas temporalmente en `catalog.routes.ts` y se extraerán al repositorio al implementar el siguiente bloque.

## 3. Punto de entrada y enrutador modular

### `apps/api/src/index.ts`

```ts
import { createApp } from './app';

export default createApp();
```

### `apps/api/src/app.ts`

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { catalogRoutes } from './modules/catalog/catalog.routes';

type Bindings = { DB: D1Database; APP_ENV: string };

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>().basePath('/api/v1');
  app.use('*', cors({ origin: ['http://localhost:5173'] }));
  app.get('/health', (context) => context.json({ status: 'ok' }));
  app.route('/catalog', catalogRoutes);
  return app;
}
```

Las rutas Hono se registran con `app.route('/catalog', catalogRoutes)`. Al crecer la API, cada módulo conservará su propio router y sus capas de servicio/repositorio.

### Control de permisos

```ts
export type Role = 'owner' | 'admin' | 'stock_manager' | 'customer';

const roleRank: Record<Role, number> = {
	customer: 10,
	stock_manager: 20,
	admin: 30,
	owner: 40,
};

export function canAccess(role: Role | undefined, minimum: Role) {
	return role !== undefined && roleRank[role] >= roleRank[minimum];
}
```

En Hono, este chequeo se aplicará mediante un middleware que obtiene el usuario desde la sesión y responde `403` cuando `canAccess` devuelve `false`. El rol `owner` es el único que puede administrar roles y permisos.

## 4. Variables de entorno

### `.env.example`

```dotenv
APP_ENV=development
VITE_API_URL=http://localhost:8787/api/v1
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8787/api/v1/auth/google/callback
# Produccion Cloudflare:
# CLOUDFLARE_ACCOUNT_ID=
# CLOUDFLARE_DATABASE_ID=
# CLOUDFLARE_API_TOKEN=
```

El binding `DB` de Wrangler apunta al D1 local durante desarrollo. Para producción se reemplaza `database_id = "local"` por el ID real de D1; el token solo se requiere para operaciones remotas de Wrangler o CI.

## 5. Esquema inicial SQLite / D1

El siguiente SQL usa tipos compatibles con SQLite y D1. Los importes se guardan en centavos para evitar errores de redondeo.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE roles (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	rank INTEGER NOT NULL UNIQUE CHECK (rank > 0)
);

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	role_id TEXT NOT NULL REFERENCES roles(id),
	username TEXT UNIQUE,
	email TEXT UNIQUE,
	password_hash TEXT,
	google_subject TEXT UNIQUE,
	display_name TEXT NOT NULL,
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CHECK (password_hash IS NOT NULL OR google_subject IS NOT NULL)
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE departments (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	slug TEXT NOT NULL UNIQUE,
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subdepartments (
	id TEXT PRIMARY KEY,
	department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	slug TEXT NOT NULL,
	UNIQUE (department_id, name),
	UNIQUE (department_id, slug)
);

CREATE TABLE products (
	id TEXT PRIMARY KEY,
	subdepartment_id TEXT NOT NULL REFERENCES subdepartments(id),
	name TEXT NOT NULL,
	slug TEXT NOT NULL UNIQUE,
	description TEXT NOT NULL DEFAULT '',
	image_url TEXT NOT NULL,
	price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
	stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX products_subdepartment_idx ON products(subdepartment_id);
CREATE INDEX products_status_idx ON products(status);
CREATE INDEX sessions_user_idx ON sessions(user_id);
```

Datos iniciales recomendados para roles: `owner` (40), `admin` (30), `stock_manager` (20) y `customer` (10). En producción, las migraciones deben ejecutarse versionadas; el `seed` nunca debe crear un owner con una contraseña conocida.

## 6. Ejemplo de módulo backend

### `apps/api/src/modules/catalog/catalog.routes.ts`

```ts
export const catalogRoutes = new Hono<{ Bindings: Bindings }>();

catalogRoutes.get('/products', async (context) => {
  const result = await context.env.DB.prepare(
    'SELECT id, name, slug, image_url, price_cents, stock_quantity FROM products WHERE status = ?',
  ).bind('active').all();
  return context.json({ data: result.results });
});
```

### `apps/api/src/modules/catalog/catalog.service.ts`

```ts
export class CatalogService {
	constructor(private readonly products: ProductRepository) {}

	async create(input: CreateProductInput) {
		const existing = await this.products.findBySlug(input.slug);
		if (existing) throw new ConflictError('PRODUCT_SLUG_EXISTS');
		return this.products.create(input);
	}
}
```

El servicio no recibe `request` ni `reply`, por lo que se puede probar con un repositorio en memoria sin levantar el servidor.

## 7. Componentes UI con enfoque UX

### Composición de la pantalla de administración

```tsx
export function InventoryPage() {
	return (
		<AdminShell title="Inventario">
			<InventoryToolbar />
			<InventoryTable />
			<ProductFormModal />
		</AdminShell>
	);
}
```

Responsabilidades separadas:

- `AdminShell`: navegación, breadcrumb, estado responsive y zona de contenido.
- `InventoryToolbar`: búsqueda, filtros de estado y acción "Nuevo artículo".
- `InventoryTable`: carga paginada, stock editable y estados loading/empty/error.
- `ProductFormModal`: nombre, departamento, subdepartamento, precio, stock, descripción y URL de imagen.
- `ImagePreview`: previsualiza la URL y muestra un fallback accesible si falla.

### Tokens y microinteracciones

```css
:root {
	--color-ink: #17211b;
	--color-muted: #68736b;
	--color-surface: #f7f8f4;
	--color-panel: #ffffff;
	--color-accent: #d96b3b;
	--color-border: #dce2dc;
	--radius-sm: 6px;
	--shadow-panel: 0 12px 32px rgb(23 33 27 / 8%);
}

.button {
	transition: transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}

.button:hover { transform: translateY(-1px); }
.button:focus-visible { outline: 3px solid color-mix(in srgb, var(--color-accent) 45%, transparent); }
```

La UI debe mantener estados explícitos para carga, vacío, error, guardado y permisos insuficientes. Los botones de acciones frecuentes deben incluir iconos y tooltip; los formularios deben conservar los datos ante un error de validación y anunciar errores con `aria-live`.

## 8. Flujo de autenticación

1. Usuario/contraseña: validar credenciales, comparar Argon2id y crear una sesión persistida.
2. Email: el email es un identificador alternativo al username; se normaliza a minúsculas y se verifica antes de habilitar acciones sensibles.
3. Google: OAuth usa `state` y PKCE; el `google_subject` vincula de forma estable la cuenta social.
4. Sesión: cookie `httpOnly`, `secure` en producción, `sameSite=lax`, expiración y revocación en logout.
5. Autorización: middleware obtiene usuario y rol desde la sesión; cada operación administrativa aplica `canAccess`.

No se deben aceptar roles enviados desde el frontend. El frontend solo oculta acciones por UX; el backend siempre vuelve a autorizar.

## 9. Orden de implementación

1. Inicializar workspace, lint, TypeScript, variables de entorno y migraciones.
2. Extraer repositorio D1 y tests de integración del esquema.
3. Implementar auth/sesiones y RBAC con tests de permisos.
4. Implementar departamentos, subdepartamentos y catálogo.
5. Construir el panel de inventario con estados de UX completos.
6. Añadir seed controlado y CI; después configurar el recurso D1 remoto.

## 10. Criterios de calidad iniciales

- Ningún archivo de entrada contiene lógica de negocio.
- Cada caso de uso tiene una prueba unitaria y cada ruta crítica una prueba HTTP.
- Todas las entradas HTTP se validan antes de llegar al servicio.
- Precios y stock se validan en aplicación y en base de datos.
- Las acciones de administración generan logs auditables antes de pasar a producción.
- Las imágenes se validan como URLs HTTPS permitidas; nunca se aceptan rutas de archivo locales.
