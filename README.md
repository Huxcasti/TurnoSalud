# TurnoSalud

Sistema web de turnos para laboratorios y hospitales, optimizado para teléfonos.

## Incluye

- Página del paciente en `/`
- Geovalla de 100 metros alrededor de `18.4687370, -66.2906547`
- Panel del empleado en `/empleado`
- Pantalla pública en `/pantalla`
- Código QR dinámico en `/qr`
- Base de datos SQLite y actualización automática

## Probar en la computadora

1. Instale Python 3.
2. Abra una terminal dentro de esta carpeta.
3. Cree un entorno: `python3 -m venv .venv`
4. Actívelo en macOS/Linux: `source .venv/bin/activate`
5. Instale: `pip install -r requirements.txt`
6. Ejecute: `python app.py`
7. Abra `http://localhost:5000`

La geolocalización funciona en `localhost`. Para probar la ubicación desde otro teléfono, publique el sitio con HTTPS.

## Publicar en Render

1. Suba el contenido de esta carpeta a un repositorio de GitHub.
2. En Render elija **New > Blueprint** y conecte el repositorio.
3. Render leerá `render.yaml`; confirme la creación del servicio.
4. Cuando diga **Live**, abra la dirección asignada.
5. Visite `/qr` para descargar el QR que apunta a la dirección final.

También puede crear un Web Service manualmente con:

- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app`

## Acceso del empleado

El PIN inicial es `1234`. Cámbielo en Render, en la variable `EMPLOYEE_PIN`. No use el PIN inicial en producción.

## Datos y producción

Esta primera versión usa SQLite. En el plan gratuito de Render, el sistema de archivos puede reiniciarse al volver a desplegar o reiniciar el servicio, por lo que los turnos pueden borrarse. Para uso real continuo, configure un disco persistente de Render y establezca `DATABASE_PATH` a una ruta en ese disco, o migre la base de datos a PostgreSQL.

La geolocalización reduce el abuso, pero ningún navegador puede garantizar por sí solo la presencia física. Antes de manejar información médica protegida, realice una revisión de privacidad, seguridad y cumplimiento legal. Esta versión solicita solamente nombre, servicio y teléfono opcional.
