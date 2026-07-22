import io
import math
import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

import qrcode
from flask import Flask, jsonify, redirect, render_template, request, send_file, session, url_for

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "cambie-esta-clave-en-render")

LATITUD = 18.3468054
LONGITUD = -66.3211463
RADIO_METROS = 500
PIN_EMPLEADO = os.environ.get("EMPLOYEE_PIN", "1234")
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(app.instance_path, "turnosalud.db"))


def conexion():
    os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def iniciar_db():
    with conexion() as db:
        db.execute("""
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
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_turnos_estado ON turnos(estado, id)")


def distancia_metros(lat1, lon1, lat2, lon2):
    radio_tierra = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radio_tierra * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def empleado_requerido(funcion):
    @wraps(funcion)
    def protegida(*args, **kwargs):
        if not session.get("empleado"):
            return jsonify({"ok": False, "error": "Sesión requerida."}), 401
        return funcion(*args, **kwargs)
    return protegida


@app.get("/")
def paciente():
    return render_template("paciente.html", latitud=LATITUD, longitud=LONGITUD, radio=RADIO_METROS)


@app.get("/empleado")
def empleado():
    return render_template("empleado.html", autenticado=bool(session.get("empleado")))


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
    return send_file(salida, mimetype="image/png", download_name="turnosalud-qr.png")


@app.post("/api/turnos")
def crear_turno():
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre", "")).strip()[:80]
    telefono = str(datos.get("telefono", "")).strip()[:20]
    servicio = str(datos.get("servicio", "")).strip()
    servicios = {"Análisis de sangre", "Entrega de muestras", "Recoger resultados", "Registro o facturación"}

    try:
        latitud = float(datos.get("latitud"))
        longitud = float(datos.get("longitud"))
        precision = float(datos.get("precision", 9999))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="No pudimos verificar su ubicación."), 400

    distancia = distancia_metros(latitud, longitud, LATITUD, LONGITUD)
    if precision > 100:
        return jsonify(ok=False, error="La señal de ubicación no es suficientemente precisa. Acérquese a una ventana e intente otra vez."), 403
    if distancia > RADIO_METROS:
        return jsonify(ok=False, error=f"Debe estar a menos de {RADIO_METROS} metros del establecimiento."), 403
    if len(nombre) < 2:
        return jsonify(ok=False, error="Escriba el nombre del paciente."), 400
    if servicio not in servicios:
        return jsonify(ok=False, error="Seleccione un servicio válido."), 400

    ahora = datetime.now(timezone.utc).isoformat()
    with conexion() as db:
        delante = db.execute("SELECT COUNT(*) FROM turnos WHERE estado IN ('esperando','actual')").fetchone()[0]
        cursor = db.execute(
            "INSERT INTO turnos(numero,nombre,telefono,servicio,creado) VALUES('pendiente',?,?,?,?)",
            (nombre, telefono, servicio, ahora),
        )
        numero = f"A-{cursor.lastrowid:03d}"
        db.execute("UPDATE turnos SET numero=? WHERE id=?", (numero, cursor.lastrowid))
    return jsonify(ok=True, numero=numero, delante=delante, espera=max(5, delante * 5), servicio=servicio)


@app.post("/api/login")
def login():
    datos = request.get_json(silent=True) or {}
    if str(datos.get("pin", "")) != PIN_EMPLEADO:
        return jsonify(ok=False, error="PIN incorrecto."), 401
    session["empleado"] = True
    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/panel")
@empleado_requerido
def datos_panel():
    with conexion() as db:
        turnos = [dict(f) for f in db.execute("SELECT * FROM turnos ORDER BY id").fetchall()]
    actual = next((t for t in turnos if t["estado"] == "actual"), None)
    return jsonify(
        ok=True,
        actual=actual,
        esperando=[t for t in turnos if t["estado"] == "esperando"],
        resumen={
            "esperando": sum(t["estado"] == "esperando" for t in turnos),
            "atendidos": sum(t["estado"] == "completado" for t in turnos),
            "ausentes": sum(t["estado"] == "ausente" for t in turnos),
            "total": len(turnos),
        },
    )


@app.get("/api/actual")
def turno_actual():
    with conexion() as db:
        fila = db.execute("SELECT numero,servicio,llamado FROM turnos WHERE estado='actual' ORDER BY id DESC LIMIT 1").fetchone()
    return jsonify(ok=True, actual=dict(fila) if fila else None)


@app.post("/api/siguiente")
@empleado_requerido
def siguiente():
    ahora = datetime.now(timezone.utc).isoformat()
    with conexion() as db:
        if db.execute("SELECT 1 FROM turnos WHERE estado='actual'").fetchone():
            return jsonify(ok=False, error="Primero complete o marque ausente el turno actual."), 409
        fila = db.execute("SELECT id FROM turnos WHERE estado='esperando' ORDER BY id LIMIT 1").fetchone()
        if not fila:
            return jsonify(ok=False, error="No hay pacientes esperando."), 404
        db.execute("UPDATE turnos SET estado='actual', llamado=? WHERE id=?", (ahora, fila["id"]))
    return jsonify(ok=True)


@app.post("/api/finalizar/<estado>")
@empleado_requerido
def finalizar(estado):
    if estado not in {"completado", "ausente"}:
        return jsonify(ok=False, error="Estado inválido."), 400
    with conexion() as db:
        fila = db.execute("SELECT id FROM turnos WHERE estado='actual' LIMIT 1").fetchone()
        if not fila:
            return jsonify(ok=False, error="No hay un turno actual."), 404
        db.execute("UPDATE turnos SET estado=?, finalizado=? WHERE id=?", (estado, datetime.now(timezone.utc).isoformat(), fila["id"]))
    return jsonify(ok=True)


@app.get("/health")
def health():
    return jsonify(ok=True)


iniciar_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
