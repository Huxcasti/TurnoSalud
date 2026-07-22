import io
import math
import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

import qrcode
from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    send_file,
    session,
    url_for,
)

app = Flask(__name__)

app.secret_key = os.environ.get(
    "SECRET_KEY",
    "cambie-esta-clave-en-render",
)

LATITUD = 18.3468054
LONGITUD = -66.3211463
RADIO_METROS = 500

PIN_EMPLEADO = os.environ.get(
    "EMPLOYEE_PIN",
    "1234",
)

DATABASE = os.environ.get(
    "DATABASE_PATH",
    os.path.join(app.instance_path, "turnosalud.db"),
)


# ============================================================
# BASE DE DATOS
# ============================================================

def conexion():
    carpeta = os.path.dirname(DATABASE)

    if carpeta:
        os.makedirs(carpeta, exist_ok=True)

    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row

    return db


def iniciar_db():
    with conexion() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS turnos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero TEXT UNIQUE,
                nombre TEXT NOT NULL,
                telefono TEXT,
                servicio TEXT NOT NULL,
                estado TEXT NOT NULL DEFAULT 'esperando',
                creado TEXT NOT NULL,
                llamado TEXT,
                finalizado TEXT
            )
            """
        )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_turnos_estado
            ON turnos(estado, id)
            """
        )


# ============================================================
# UBICACIÓN
# ============================================================

def distancia_metros(lat1, lon1, lat2, lon2):
    radio_tierra = 6371000

    p1 = math.radians(lat1)
    p2 = math.radians(lat2)

    diferencia_latitud = math.radians(lat2 - lat1)
    diferencia_longitud = math.radians(lon2 - lon1)

    a = (
        math.sin(diferencia_latitud / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(diferencia_longitud / 2) ** 2
    )

    return radio_tierra * 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a),
    )


# ============================================================
# PROTECCIÓN DEL ÁREA DEL EMPLEADO
# ============================================================

def empleado_requerido(funcion):
    @wraps(funcion)
    def protegida(*args, **kwargs):
        if not session.get("empleado"):
            return jsonify(
                ok=False,
                error="Sesión requerida.",
            ), 401

        return funcion(*args, **kwargs)

    return protegida


# ============================================================
# PÁGINAS
# ============================================================

@app.get("/")
def paciente():
    return render_template(
        "paciente.html",
        latitud=LATITUD,
        longitud=LONGITUD,
        radio=RADIO_METROS,
    )


@app.get("/empleado")
def empleado():
    return render_template(
        "empleado.html",
        autenticado=bool(session.get("empleado")),
    )


@app.get("/pantalla")
def pantalla():
    return render_template("pantalla.html")


@app.get("/qr")
def pagina_qr():
    return render_template("qr.html")


@app.get("/qr.png")
def imagen_qr():
    destino = request.url_root.rstrip("/") + url_for("paciente")

    imagen = qrcode.make(destino)

    salida = io.BytesIO()
    imagen.save(salida, format="PNG")
    salida.seek(0)

    return send_file(
        salida,
        mimetype="image/png",
        download_name="turnosalud-qr.png",
    )


# ============================================================
# CREAR TURNO
# ============================================================

@app.post("/api/turnos")
def crear_turno():
    datos = request.get_json(silent=True) or {}

    nombre = str(
        datos.get("nombre", "")
    ).strip()[:80]

    telefono = str(
        datos.get("telefono", "")
    ).strip()[:20]

    servicio = str(
        datos.get("servicio", "")
    ).strip()

    servicios_validos = {
        "Análisis de sangre",
        "Entrega de muestras",
        "Recoger resultados",
        "Registro o facturación",
    }

    try:
        latitud = float(datos.get("latitud"))
        longitud = float(datos.get("longitud"))
        precision = float(datos.get("precision", 9999))

    except (TypeError, ValueError):
        return jsonify(
            ok=False,
            error="No pudimos verificar su ubicación.",
        ), 400

    distancia = distancia_metros(
        latitud,
        longitud,
        LATITUD,
        LONGITUD,
    )

    if precision > 100:
        return jsonify(
            ok=False,
            error=(
                "La señal de ubicación no es suficientemente precisa. "
                "Acérquese a una ventana e intente otra vez."
            ),
        ), 403

    if distancia > RADIO_METROS:
        return jsonify(
            ok=False,
            error=(
                f"Debe estar a menos de "
                f"{RADIO_METROS} metros del establecimiento."
            ),
        ), 403

    if len(nombre) < 2:
        return jsonify(
            ok=False,
            error="Escriba el nombre del paciente.",
        ), 400

    if servicio not in servicios_validos:
        return jsonify(
            ok=False,
            error="Seleccione un servicio válido.",
        ), 400

    ahora = datetime.now(timezone.utc).isoformat()

    with conexion() as db:
        delante = db.execute(
            """
            SELECT COUNT(*)
            FROM turnos
            WHERE estado IN ('esperando', 'actual')
            """
        ).fetchone()[0]

        cursor = db.execute(
            """
            INSERT INTO turnos (
                numero,
                nombre,
                telefono,
                servicio,
                creado
            )
            VALUES (
                NULL,
                ?,
                ?,
                ?,
                ?
            )
            """,
            (
                nombre,
                telefono,
                servicio,
                ahora,
            ),
        )

        turno_id = cursor.lastrowid
        numero = f"A-{turno_id:03d}"

        db.execute(
            """
            UPDATE turnos
            SET numero = ?
            WHERE id = ?
            """,
            (
                numero,
                turno_id,
            ),
        )

    return jsonify(
        ok=True,
        numero=numero,
        delante=delante,
        espera=max(5, delante * 5),
        servicio=servicio,
    )


# ============================================================
# INICIAR Y CERRAR SESIÓN
# ============================================================

@app.post("/api/login")
def login():
    datos = request.get_json(silent=True) or {}

    if str(datos.get("pin", "")) != PIN_EMPLEADO:
        return jsonify(
            ok=False,
            error="PIN incorrecto.",
        ), 401

    session["empleado"] = True

    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    session.clear()

    return jsonify(ok=True)


# ============================================================
# DATOS DEL PANEL
# ============================================================

@app.get("/api/panel")
@empleado_requerido
def datos_panel():
    with conexion() as db:
        filas = db.execute(
            """
            SELECT *
            FROM turnos
            ORDER BY id
            """
        ).fetchall()

        turnos = [
            dict(fila)
            for fila in filas
        ]

    actual = next(
        (
            turno
            for turno in turnos
            if turno["estado"] == "actual"
        ),
        None,
    )

    esperando = [
        turno
        for turno in turnos
        if turno["estado"] == "esperando"
    ]

    return jsonify(
        ok=True,
        actual=actual,
        esperando=esperando,
        resumen={
            "esperando": sum(
                turno["estado"] == "esperando"
                for turno in turnos
            ),
            "atendidos": sum(
                turno["estado"] == "completado"
                for turno in turnos
            ),
            "ausentes": sum(
                turno["estado"] == "ausente"
                for turno in turnos
            ),
            "total": len(turnos),
        },
    )


# ============================================================
# TURNO MOSTRADO EN LA PANTALLA PÚBLICA
# ============================================================

@app.get("/api/actual")
def turno_actual():
    with conexion() as db:
        fila = db.execute(
            """
            SELECT
                numero,
                nombre,
                servicio,
                llamado
            FROM turnos
            WHERE estado = 'actual'
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    return jsonify(
        ok=True,
        actual=dict(fila) if fila else None,
    )


# ============================================================
# LLAMAR AL SIGUIENTE TURNO
# ============================================================

@app.post("/api/siguiente")
@empleado_requerido
def siguiente():
    ahora = datetime.now(timezone.utc).isoformat()

    with conexion() as db:
        turno_actual_existente = db.execute(
            """
            SELECT id
            FROM turnos
            WHERE estado = 'actual'
            LIMIT 1
            """
        ).fetchone()

        if turno_actual_existente:
            return jsonify(
                ok=False,
                error=(
                    "Primero complete o marque ausente "
                    "el turno actual."
                ),
            ), 409

        fila = db.execute(
            """
            SELECT id
            FROM turnos
            WHERE estado = 'esperando'
            ORDER BY id
            LIMIT 1
            """
        ).fetchone()

        if not fila:
            return jsonify(
                ok=False,
                error="No hay pacientes esperando.",
            ), 404

        db.execute(
            """
            UPDATE turnos
            SET
                estado = 'actual',
                llamado = ?
            WHERE id = ?
            """,
            (
                ahora,
                fila["id"],
            ),
        )

    return jsonify(ok=True)


# ============================================================
# LLAMAR UN TURNO PRIORITARIO
# ============================================================

@app.post("/api/llamar/<int:turno_id>")
@empleado_requerido
def llamar_turno_prioritario(turno_id):
    ahora = datetime.now(timezone.utc).isoformat()

    with conexion() as db:
        turno_actual_existente = db.execute(
            """
            SELECT
                id,
                numero
            FROM turnos
            WHERE estado = 'actual'
            LIMIT 1
            """
        ).fetchone()

        if turno_actual_existente:
            return jsonify(
                ok=False,
                error=(
                    "Ya existe un turno actual. "
                    "Primero complételo o márquelo ausente."
                ),
            ), 409

        turno = db.execute(
            """
            SELECT
                id,
                numero,
                nombre,
                servicio,
                estado
            FROM turnos
            WHERE id = ?
            LIMIT 1
            """,
            (turno_id,),
        ).fetchone()

        if not turno:
            return jsonify(
                ok=False,
                error="El turno seleccionado no existe.",
            ), 404

        if turno["estado"] != "esperando":
            return jsonify(
                ok=False,
                error="Ese turno ya no está en espera.",
            ), 409

        db.execute(
            """
            UPDATE turnos
            SET
                estado = 'actual',
                llamado = ?
            WHERE id = ?
            """,
            (
                ahora,
                turno_id,
            ),
        )

    return jsonify(
        ok=True,
        turno={
            "id": turno["id"],
            "numero": turno["numero"],
            "nombre": turno["nombre"],
            "servicio": turno["servicio"],
        },
    )


# ============================================================
# FINALIZAR TURNO
# ============================================================

@app.post("/api/finalizar/<estado>")
@empleado_requerido
def finalizar(estado):
    if estado not in {
        "completado",
        "ausente",
    }:
        return jsonify(
            ok=False,
            error="Estado inválido.",
        ), 400

    ahora = datetime.now(timezone.utc).isoformat()

    with conexion() as db:
        fila = db.execute(
            """
            SELECT id
            FROM turnos
            WHERE estado = 'actual'
            LIMIT 1
            """
        ).fetchone()

        if not fila:
            return jsonify(
                ok=False,
                error="No hay un turno actual.",
            ), 404

        db.execute(
            """
            UPDATE turnos
            SET
                estado = ?,
                finalizado = ?
            WHERE id = ?
            """,
            (
                estado,
                ahora,
                fila["id"],
            ),
        )

    return jsonify(ok=True)


# ============================================================
# VERIFICACIÓN DEL SERVIDOR
# ============================================================

@app.get("/health")
def health():
    return jsonify(ok=True)


# ============================================================
# INICIAR APLICACIÓN
# ============================================================

iniciar_db()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(
            os.environ.get(
                "PORT",
                "5000",
            )
        ),
        debug=True,
    )