const $ = (selector) => document.querySelector(selector);

const page = document.body.dataset.page;


/* ============================================================
   PETICIONES AL SERVIDOR
   ============================================================ */

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      "El servidor devolvió una respuesta inválida."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error || "Ocurrió un error."
    );
  }

  return data;
}


/* ============================================================
   MENSAJES
   ============================================================ */

function errorBox(selector, message) {
  const box = $(selector);

  if (!box) {
    return;
  }

  box.textContent = message;
  box.classList.remove("hidden");
}


/* ============================================================
   SONIDO
   ============================================================ */

function beep() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.frequency.value = 720;
    gain.gain.value = 0.08;

    oscillator.start();
    oscillator.stop(
      context.currentTime + 0.22
    );
  } catch (error) {
    console.log(
      "No se pudo reproducir el sonido.",
      error
    );
  }
}


/* ============================================================
   ÁREA DEL PACIENTE
   ============================================================ */

if (page === "paciente") {
  let locationData = null;
  let service = "";

  $("#verify-location").onclick = () => {
    if (!navigator.geolocation) {
      errorBox(
        "#patient-error",
        "Este navegador no permite verificar la ubicación."
      );

      return;
    }

    $("#location-text").textContent =
      "Verificando ubicación…";

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const {
          latitude,
          longitude,
          accuracy,
        } = position.coords;

        const radianes = (valor) =>
          valor * Math.PI / 180;

        const diferenciaLatitud = radianes(
          latitude - TURNO_CONFIG.lat
        );

        const diferenciaLongitud = radianes(
          longitude - TURNO_CONFIG.lng
        );

        const a =
          Math.sin(
            diferenciaLatitud / 2
          ) ** 2
          +
          Math.cos(
            radianes(TURNO_CONFIG.lat)
          )
          *
          Math.cos(
            radianes(latitude)
          )
          *
          Math.sin(
            diferenciaLongitud / 2
          ) ** 2;

        const distance =
          6371000
          *
          2
          *
          Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
          );

        if (accuracy > 100) {
          errorBox(
            "#patient-error",
            "La señal no es suficientemente precisa. Acérquese a una ventana e intente otra vez."
          );

          return;
        }

        if (distance > TURNO_CONFIG.radius) {
          errorBox(
            "#patient-error",
            `Está aproximadamente a ${Math.round(distance)} m. Debe estar a menos de ${TURNO_CONFIG.radius} m.`
          );

          return;
        }

        locationData = {
          latitud: latitude,
          longitud: longitude,
          precision: accuracy,
        };

        $("#location-box").classList.add("ok");

        $("#location-text").textContent =
          "Ubicación confirmada. Puede tomar su turno.";

        $("#patient-fields").disabled = false;

        $("#patient-error").classList.add("hidden");
      },

      () => {
        errorBox(
          "#patient-error",
          "No pudimos obtener su ubicación. Permita el acceso e intente otra vez."
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };


  document
    .querySelectorAll(".service")
    .forEach((button) => {
      button.onclick = () => {
        document
          .querySelectorAll(".service")
          .forEach((item) => {
            item.classList.remove("selected");
          });

        button.classList.add("selected");

        service = button.dataset.service;
      };
    });


  $("#take-ticket").onclick = async () => {
    try {
      if (!locationData) {
        throw new Error(
          "Primero verifique su ubicación."
        );
      }

      const data = await api(
        "/api/turnos",
        {
          method: "POST",
          body: JSON.stringify({
            ...locationData,
            nombre: $("#name").value,
            telefono: $("#phone").value,
            servicio: service,
          }),
        }
      );

      $("#ticket-number").textContent =
        data.numero;

      $("#ahead").textContent =
        data.delante;

      $("#wait").textContent =
        data.espera + " min";

      $("#service-result").textContent =
        data.servicio;

      $("#form-card").classList.add(
        "hidden"
      );

      $("#confirmation").classList.remove(
        "hidden"
      );

    } catch (error) {
      errorBox(
        "#patient-error",
        error.message
      );
    }
  };


  $("#new-ticket").onclick = () => {
    location.reload();
  };
}


/* ============================================================
   ÁREA DEL EMPLEADO
   ============================================================ */

if (page === "empleado") {
  let lastCall = null;
  let loadingPanel = false;


  /* ----------------------------------------------------------
     INICIAR SESIÓN
     ---------------------------------------------------------- */

  $("#login")?.addEventListener(
    "click",
    async () => {
      try {
        await api(
          "/api/login",
          {
            method: "POST",
            body: JSON.stringify({
              pin: $("#pin").value,
            }),
          }
        );

        $("#login-card").classList.add(
          "hidden"
        );

        $("#employee-panel").classList.remove(
          "hidden"
        );

        await loadPanel();

      } catch (error) {
        errorBox(
          "#login-error",
          error.message
        );
      }
    }
  );


  $("#pin")?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        $("#login")?.click();
      }
    }
  );


  /* ----------------------------------------------------------
     CERRAR SESIÓN
     ---------------------------------------------------------- */

  $("#logout")?.addEventListener(
    "click",
    async () => {
      try {
        await api(
          "/api/logout",
          {
            method: "POST",
          }
        );
      } finally {
        location.reload();
      }
    }
  );


  /* ----------------------------------------------------------
     CREAR UNA CELDA
     ---------------------------------------------------------- */

  function crearCelda(valor, clase = "") {
    const td = document.createElement("td");

    td.textContent = valor;

    if (clase) {
      td.className = clase;
    }

    return td;
  }


  /* ----------------------------------------------------------
     LLAMAR TURNO PRIORITARIO
     ---------------------------------------------------------- */

  async function llamarPrioritario(turno) {
    const numeroActual =
      $("#current-number").textContent.trim();

    if (
      numeroActual &&
      numeroActual !== "—"
    ) {
      alert(
        "Ya existe un turno actual. Primero debe completarlo o marcarlo ausente."
      );

      return;
    }

    const confirmado = confirm(
      `¿Desea llamar ahora el turno ${turno.numero}?\n\nPaciente: ${turno.nombre}\nServicio: ${turno.servicio}`
    );

    if (!confirmado) {
      return;
    }

    try {
      await api(
        `/api/llamar/${turno.id}`,
        {
          method: "POST",
        }
      );

      beep();

      await loadPanel();

    } catch (error) {
      alert(error.message);

      await loadPanel();
    }
  }


  /* ----------------------------------------------------------
     ACTUALIZAR PANEL
     ---------------------------------------------------------- */

  async function loadPanel() {
    if (loadingPanel) {
      return;
    }

    loadingPanel = true;

    try {
      const data = await api(
        "/api/panel"
      );

      $("#stat-waiting").textContent =
        data.resumen.esperando;

      $("#stat-completed").textContent =
        data.resumen.atendidos;

      $("#stat-absent").textContent =
        data.resumen.ausentes;

      $("#stat-total").textContent =
        data.resumen.total;

      $("#current-number").textContent =
        data.actual?.numero || "—";

      $("#current-name").textContent =
        data.actual?.nombre ||
        "No hay paciente llamado";

      $("#current-service").textContent =
        data.actual?.servicio || "";

      const body = $("#queue-body");

      body.textContent = "";

      data.esperando.forEach(
        (turno) => {
          const row =
            document.createElement("tr");

          row.className =
            "priority-row";

          row.tabIndex = 0;

          row.setAttribute(
            "role",
            "button"
          );

          row.setAttribute(
            "aria-label",
            `Llamar turno ${turno.numero}, paciente ${turno.nombre}`
          );

          const fechaCreacion =
            Date.parse(turno.creado);

          const minutosEsperando =
            Number.isNaN(fechaCreacion)
              ? 0
              : Math.max(
                  0,
                  Math.floor(
                    (
                      Date.now()
                      -
                      fechaCreacion
                    )
                    /
                    60000
                  )
                );

          row.appendChild(
            crearCelda(turno.numero)
          );

          row.appendChild(
            crearCelda(turno.nombre)
          );

          row.appendChild(
            crearCelda(turno.servicio)
          );

          row.appendChild(
            crearCelda(
              `${minutosEsperando} min`
            )
          );

          const actionCell =
            document.createElement("td");

          actionCell.className =
            "queue-action-cell";

          const callButton =
            document.createElement("button");

          callButton.type = "button";

          callButton.className =
            "priority-button";

          callButton.textContent =
            "Llamar";

          callButton.setAttribute(
            "aria-label",
            `Llamar el turno ${turno.numero}`
          );

          callButton.addEventListener(
            "click",
            async (event) => {
              event.stopPropagation();

              await llamarPrioritario(
                turno
              );
            }
          );

          actionCell.appendChild(
            callButton
          );

          row.appendChild(
            actionCell
          );

          row.addEventListener(
            "click",
            async () => {
              await llamarPrioritario(
                turno
              );
            }
          );

          row.addEventListener(
            "keydown",
            async (event) => {
              if (
                event.key === "Enter"
                ||
                event.key === " "
              ) {
                event.preventDefault();

                await llamarPrioritario(
                  turno
                );
              }
            }
          );

          body.appendChild(row);
        }
      );

      $("#queue-empty").classList.toggle(
        "hidden",
        data.esperando.length > 0
      );

      lastCall =
        data.actual?.llamado ||
        lastCall;

    } catch (error) {
      if (
        error.message ===
        "Sesión requerida."
      ) {
        location.reload();

        return;
      }

      console.error(
        "No se pudo actualizar el panel:",
        error
      );

    } finally {
      loadingPanel = false;
    }
  }


  /* ----------------------------------------------------------
     REALIZAR ACCIONES
     ---------------------------------------------------------- */

  async function action(url) {
    try {
      await api(
        url,
        {
          method: "POST",
        }
      );

      await loadPanel();

    } catch (error) {
      alert(error.message);
    }
  }


  /* ----------------------------------------------------------
     LLAMAR SIGUIENTE
     ---------------------------------------------------------- */

  $("#next")?.addEventListener(
    "click",
    async () => {
      try {
        await api(
          "/api/siguiente",
          {
            method: "POST",
          }
        );

        beep();

        await loadPanel();

      } catch (error) {
        alert(error.message);
      }
    }
  );


  /* ----------------------------------------------------------
     VOLVER A LLAMAR
     ---------------------------------------------------------- */

  $("#recall")?.addEventListener(
    "click",
    () => {
      const numero =
        $("#current-number")
          .textContent
          .trim();

      if (numero === "—") {
        alert(
          "No hay un turno actual."
        );

        return;
      }

      beep();

      alert(
        `Se volvió a llamar el turno ${numero}`
      );
    }
  );


  /* ----------------------------------------------------------
     AUSENTE
     ---------------------------------------------------------- */

  $("#absent")?.addEventListener(
    "click",
    async () => {
      const numero =
        $("#current-number")
          .textContent
          .trim();

      if (numero === "—") {
        alert(
          "No hay un turno actual."
        );

        return;
      }

      const confirmado = confirm(
        `¿Desea marcar el turno ${numero} como ausente?`
      );

      if (!confirmado) {
        return;
      }

      await action(
        "/api/finalizar/ausente"
      );
    }
  );


  /* ----------------------------------------------------------
     COMPLETAR
     ---------------------------------------------------------- */

  $("#complete")?.addEventListener(
    "click",
    async () => {
      const numero =
        $("#current-number")
          .textContent
          .trim();

      if (numero === "—") {
        alert(
          "No hay un turno actual."
        );

        return;
      }

      const confirmado = confirm(
        `¿Desea completar el turno ${numero}?`
      );

      if (!confirmado) {
        return;
      }

      await action(
        "/api/finalizar/completado"
      );
    }
  );


  /* ----------------------------------------------------------
     INICIAR ACTUALIZACIÓN AUTOMÁTICA
     ---------------------------------------------------------- */

  if (
    !$("#employee-panel")
      ?.classList
      .contains("hidden")
  ) {
    loadPanel();

    setInterval(
      loadPanel,
      3000
    );
  }
}


/* ============================================================
   PANTALLA PÚBLICA
   ============================================================ */

if (page === "pantalla") {
  let last = null;


  async function refresh() {
    try {
      const data = await api(
        "/api/actual"
      );

      $("#screen-number").textContent =
        data.actual?.numero || "—";

      $("#screen-message").textContent =
        data.actual
          ? "Pase al área de servicio"
          : "Espere a que llamen su turno";

      $("#screen-service").textContent =
        data.actual?.servicio || "";

      if (
        data.actual?.llamado
        &&
        last
        &&
        data.actual.llamado !== last
      ) {
        beep();
      }

      last =
        data.actual?.llamado ||
        null;

    } catch (error) {
      console.error(
        "No se pudo actualizar la pantalla:",
        error
      );
    }
  }


  refresh();

  setInterval(
    refresh,
    2000
  );
}