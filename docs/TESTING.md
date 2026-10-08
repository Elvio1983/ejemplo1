# Validación del dashboard (PR #2)

## Ejecutar localmente

Requisitos: Node.js 24.x (incluye npm) y Python 3. No se requieren paquetes npm,
credenciales, navegador ni una hoja de Google Sheets real. No hay dependencias
que instalar; por eso no se usa `npm ci`, caché npm ni `package-lock.json`.

```bash
git clone https://github.com/Elvio1983/ejemplo1.git
cd ejemplo1
git switch codex/design-dashboard-for-web-programming-course
npm run validate
```

Si ya tienes el repositorio, cambia a esa rama y actualízala con `git pull --ff-only`.
Los comandos individuales son:

```bash
npm run check:html
npm run check:js
npm test
```

## Qué valida

| Archivo | Función |
| --- | --- |
| `.github/workflows/dashboard-validation.yml` | Ejecuta los tres controles al actualizar el PR hacia `main`, hacer push a `main` o a la rama del PR, o mediante ejecución manual. |
| `package.json` | Proporciona los comandos anteriores, sin dependencias externas. |
| `scripts/check-html.py` | Comprueba doctype, estructura básica, etiquetas sin cerrar o mal anidadas y atributos/IDs duplicados. |
| `scripts/check-syntax.mjs` | Compila todos los scripts inline clásicos de `index.html` sin ejecutarlos; comprueba también sintaxis de los archivos JS de apoyo. |
| `tests/helpers/dashboard.mjs` | Lee el `index.html` real y ejecuta su JavaScript completo en un contexto nuevo por prueba, con DOM, canvas y fetch simulados. |
| `tests/dashboard.test.mjs` | Prueba CSV, columnas, números, mediana, filtros, ordenamiento, búsqueda, KPIs, tablas, eventos y carga/error de red. |

Resultado inicial: **28 pruebas aprobadas, 0 fallos obligatorios, 4 TODO**.
Los TODO son especificaciones ejecutables de defectos existentes: actualmente
fallan sus aserciones, pero `node:test` no les da un código de salida de error.
Por ello el log puede mostrar `failing tests` junto a esos cuatro TODO aunque
el job termine verde. Un fallo en cualquiera de las 28 pruebas obligatorias
sí produce salida distinta de cero y bloquea el job.

La validación HTML es estructural y exige cierres explícitos para etiquetas no
vacías. No reemplaza un validador completo de conformidad HTML5; no valida CSS,
accesibilidad ni todas las reglas semánticas de tablas/formularios. Los dobles
de DOM/canvas verifican lógica y llamadas, no diseño visual, XSS ejecutado por
un navegador, CORS real, permisos de Sheets ni tiempos de solicitudes reales.
Si se añaden scripts externos o módulos, el cargador falla explícitamente:
hay que ampliarlo para ejecutarlos y comprobarlos antes de aceptar ese cambio.

## Verificar en GitHub

1. En el PR #2, comprueba en **Files changed** que estén los siete archivos de
   esta configuración. `index.html` conserva el código del dashboard del PR.
2. Abre **Checks** y busca el workflow **Dashboard validation**, job
   **HTML and dashboard tests**. En sus pasos deben aparecer:
   `HTML structure OK`, `JavaScript syntax OK` y el resumen de 28 pass / 4 todo.
3. También puedes abrir **Actions → Dashboard validation** y elegir el run del
   commit recién subido. Puede haber dos runs: `push` prueba la rama y
   `pull_request` prueba el commit de integración con `main`.
4. Si no aparece un run, comprueba **Settings → Actions → General** y permite
   GitHub Actions y las acciones oficiales `actions/checkout` / `actions/setup-node`.
   Si GitHub muestra un aviso de aprobación de workflow, un mantenedor debe
   aprobarlo. La configuración no usa secretos ni `pull_request_target`.
5. Si el workflow aún no está en `main`, el botón **Run workflow** puede no
   aparecer: `workflow_dispatch` necesita el archivo en la rama por defecto.
   Mientras tanto, un nuevo push a la rama del PR dispara la validación.
6. Para repetir un run ya existente, usa **Re-run all jobs**. Después de corregir
   código, sube un nuevo commit y revisa los checks de ese commit, no los del anterior.
7. Una vez que el check haya aparecido, un administrador puede exigir
   **HTML and dashboard tests** en la regla de protección/ruleset de `main`.
   El workflow por sí solo no establece ese requisito ni fusiona el PR.

## Ampliar las pruebas

Edita `tests/dashboard.test.mjs`, llama a `await createDashboard()` y usa
`api` para las funciones/estado reales y `element(id)` para los controles.
Cada prueba obtiene un contexto independiente. Para comparar arreglos u objetos
provenientes del contexto VM, usa `plain(...)` antes de `assert.deepEqual`.
No copies funciones del dashboard a las pruebas.

Ejemplo de filtro y búsqueda combinados:

```js
test('solo aprobados que coinciden con la búsqueda', async () => {
  const { api, element } = await createDashboard();
  api.ST.rows = [['Ana Perez', '18'], ['Ana Ruiz', '10'], ['Bruno', '14']];
  element('estado').value = 'aprobado';
  element('buscar').value = ' ana ';
  element('orden').value = 'desc';
  assert.deepEqual(plain(api.getRows().map(row => row[0])), ['Ana Perez']);
});
```

| Área | Casos siguientes y criterio esperado |
| --- | --- |
| Parser CSV | Filas con distinto número de columnas; comillas sin cerrar; delimitador `;` y tabulación si se decide soportarlos; espacios significativos dentro de comillas; archivo grande. Definir si se rechaza o normaliza cada formato y afirmar esa decisión. |
| Columnas y números | `Nota parcial` junto a `Nota final` (priorizar final); encabezados con espacios/acentos; notas vacías y texto (rechazar, no convertir a 0); límites de la escala 0–20. Definir una política para columnas desconocidas en vez de asumir que la última es la nota. |
| Filtros | 0, 10.99, 11 y 20; vacíos/invalidos excluidos; ningún resultado; combinación con búsqueda y orden. Verificar filas y KPIs resultantes. |
| Ordenamiento | Empates (definir estabilidad o desempate), nombres con tildes/ñ, nombres vacíos, repetidos. Confirmar que `ST.rows` no cambia y Top 15 sigue por nota descendente. |
| Búsqueda | Tildes (`Jose` frente a `José`: definir si debe coincidir), ñ, nombres vacíos, espacios y subcadenas; búsqueda por código si se decide agregarla. |
| Google Sheets | `gid` en fragmento y query; export con parámetros en distinto orden; enlace publicado `/d/e/.../pub`; HTTP 401/403/404/429/500; respuesta HTML de login; CSV vacío; errores en `res.text()`; solicitudes simultáneas que llegan fuera de orden. |
| Render y gráficos | Escapar encabezados/celdas importados; donut sin datos; bins en límites decimales como 10.995 y 13.995; resize y DPR=2; tablas con nombres vacíos. Añadir pruebas en navegador para resultado visual y ejecución de HTML importado. |

Ejemplo de carga/error sin consultar Google:

```js
const dashboard = await createDashboard({
  fetchImpl: async url => {
    assert.match(url, /export\?format=csv/);
    return csvResponse('Estudiante,Nota final\nAna,18\n');
  },
});
assert.equal(dashboard.element('kTotal').textContent, 1);

const failed = await createDashboard({
  fetchImpl: async () => ({ ok: false, status: 429 }),
});
assert.match(failed.element('status').textContent, /HTTP 429/);
```

Para probar demora o concurrencia, amplía el helper para esperar explícitamente
la carga inicial y controlar las promesas de `fetch`; su drenaje actual asume
fixtures que resuelven o rechazan inmediatamente. Para CORS y permisos reales,
usa manualmente una hoja de pruebas pública sin datos de estudiantes, prueba
la pestaña seleccionada y una hoja privada, y revisa Network/Console.

## Cuatro regresiones pendientes antes de aprobar el dashboard

1. **Notas inválidas:** validar el texto completo en `toNum`; devolver `null`
   para vacío, ausente o texto, conservando el cero numérico válido.
2. **Pestaña Sheets:** usar `URL`, comprobar exactamente el host de Google y
   conservar `gid` de query/fragmento al construir el export CSV. Adaptar el
   contexto de prueba para exponer `URL` si se usa esa API del navegador.
3. **CSV incompleto:** rechazar comillas sin cerrar y mostrar un error de carga.
4. **HTML importado:** escapar encabezados y celdas antes de interpolarlos o
   construir nodos y asignar `textContent`. Si se opta por nodos, ampliar el DOM
   simulado y reemplazar la aserción de escape por una aserción de texto literal.

Corrige cada defecto en `index.html`, elimina su opción `{ todo: ... }`, añade
casos límite y ejecuta `npm run validate`. No marques nuevas regresiones como
TODO para conseguir un check verde. El resultado verde inicial configura CI;
no demuestra que estas cuatro regresiones hayan sido corregidas.

Referencias oficiales:
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://github.com/actions/checkout
- https://github.com/actions/setup-node
- https://nodejs.org/api/test.html
