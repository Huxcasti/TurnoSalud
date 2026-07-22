const $ = function (selector) {
  return document.querySelector(selector);
};

const page = (document.body.getAttribute("data-page") || "").trim();


/* ============================================================
   CONEXIÓN CON EL SERVIDOR
   ============================================================ */

async function api(url, options) {
  options = options || {};

  const config = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (options.body) {
    config.body = options.body;
  }

  const response = await fetch(url, config);

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error("El servidor devolvió una respuesta inválida.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Ocurrió un error.");
  }

  return data;
}


/* ============================================================
   MOSTRAR ERRORES
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

    if (!AudioContextClass) {
      return;
    }

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.frequency.value = 720;
    gain.gain.value = 0.08;

    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);

  } catch (error) {
    console.log("No se pudo reproducir el sonido.");
  }
}


/* ============================================================
   PÁGINA DEL PACIENTE
   ============================================================ */

if (page === "paciente") {
  let locationData = null;
  let service = "";

  const verifyButton = $("#verify-location");
  const takeTicketButton = $("#take-ticket");
  const newTicketButton = $("#new-ticket");

  if (verifyButton) {
    verifyButton.addEventListener("click", function () {
      if (!navigator.geolocation) {
        errorBox(
          "#patient-error",
          "Este navegador no permite verificar la ubicación."
        );

        return;
      }

      $("#location-text").textContent = "Verificando ubicación…";

      navigator.geolocation.getCurrentPosition(
        function (position) {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const accuracy = position.coords.accuracy;

          function radianes(valor) {
            return valor * Math.PI / 180;
          }

          const diferenciaLatitud =
            radianes(latitude - TURNO_CONFIG.lat);

          const diferenciaLongitud =
            radianes(longitude - TURNO_CONFIG.lng);

          const a =
            Math.sin(diferenciaLatitud / 2) ** 2 +
            Math.cos(radianes(TURNO_CONFIG.lat)) *
            Math.cos(radianes(latitude)) *
            Math.sin(diferenciaLongitud / 2) ** 2;

          const distance =
            6371000 *
            2 *
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
              "Está aproximadamente a " +
              Math.round(distance) +
              " m. Debe estar a menos de " +
              TURNO_CONFIG.radius +
              " m."
            );

            return;
          }

          locationData = {
            latitud: latitude,
            longitud: longitude,
            precision: accuracy
          };

          $("#location-box").classList.add("ok");

          $("#location-text").textContent =
            "Ubicación confirmada. Puede tomar su turno.";

          $("#patient-fields").disabled = false;
          $("#patient-error").classList.add("hidden");
        },

        function () {
          errorBox(
            "#patient-error",
            "No pudimos obtener su ubicación. Permita el acceso e intente otra vez."
          );
        },

        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    });
  }


  document.querySelectorAll(".service").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll(".service").forEach(function (item) {
        item.classList.remove("selected");
      });

      button.classList.add("selected");
      service = button.getAttribute("data-service");
    });
  });


  if (takeTicketButton) {
    takeTicketButton.addEventListener("click", async function () {
      try {
        if (!locationData) {
          throw new Error("Primero verifique su ubicación.");
        }

        if (!service) {
          throw new Error("Seleccione el servicio que necesita.");
        }

        const data = await api("/api/turnos", {
          method: "POST",
          body: JSON.stringify({
            latitud: locationData.latitud,
            longitud: locationData.longitud,
            precision: locationData.precision,
            nombre: $("#name").value,
            telefono: $("#phone").value,
            servicio: service
          })
        });

        $("#ticket-number").textContent = data.numero;
        $("#ahead").textContent = data.delante;
        $("#wait").textContent = data.espera + " min";
        $("#service-result").textContent = data.servicio;

        $("#form-card").classList.add("hidden");
        $("#confirmation").classList.remove("hidden");

      } catch (error) {
        errorBox("#patient-error", error.message);
      }
    });
  }


  if (newTicketButton) {
    newTicketButton.addEventListener("click", function () {
      window.location.reload();
    });
  }
}


/* ============================================================
   ÁREA DEL EMPLEADO
   ============================================================ */

if (page === "empleado") {
  let actualizandoPanel = false;


  /* ----------------------------------------------------------
     INICIAR SESIÓN
     ---------------------------------------------------------- */

  const loginButton = $("#login");

  if (loginButton) {
    loginButton.addEventListener("click", async function () {
      try {
        const pinInput = $("#pin");

        await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            pin: pinInput ? pinInput.value : ""
          })
        });

        $("#login-card").classList.add("hidden");
        $("#employee-panel").classList.remove("hidden");

        await cargarPanel();

      } catch (error) {
        errorBox("#login-error", error.message);
      }
    });
  }


  const pinInput = $("#pin");

  if (pinInput) {
    pinInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && loginButton) {
        loginButton.click();
      }
    });
  }


  /* ----------------------------------------------------------
     CERRAR SESIÓN
     ---------------------------------------------------------- */

  const logoutButton = $("#logout");

  if (logoutButton) {
    logoutButton.addEventListener("click", async function () {
      try {
        await api("/api/logout", {
          method: "POST"
        });

        window.location.href = "/empleado";

      } catch (error) {
        alert(error.message);
      }
    });
  }


  /* ----------------------------------------------------------
     CREAR CELDA
     ---------------------------------------------------------- */

  function crearCelda(valor, clase) {
    const celda = document.createElement("td");

    celda.textContent = valor;

    if (clase) {
      celda.className = clase;
    }

    return celda;
  }


  /* ----------------------------------------------------------
     LLAMAR TURNO PRIORITARIO
     ---------------------------------------------------------- */

  async function llamarPrioritario(turno) {
    const currentNumber = $("#current-number");
    const numeroActual = currentNumber
      ? currentNumber.textContent.trim()
      : "—";

    if (numeroActual !== "—") {
      alert(
        "Ya existe un turno actual. Primero debe completarlo o marcarlo ausente."
      );

      return;
    }

    const confirmado = window.confirm(
      "¿Desea llamar ahora el turno " +
      turno.numero +
      "?\n\nPaciente: " +
      turno.nombre +
      "\nServicio: " +
      turno.servicio
    );

    if (!confirmado) {
      return;
    }

    try {
      await api("/api/llamar/" + turno.id, {
        method: "POST"
      });

      beep();
      await cargarPanel();

    } catch (error) {
      alert(error.message);
      await cargarPanel();
    }
  }


  /* ----------------------------------------------------------
     CARGAR PANEL
     ---------------------------------------------------------- */

  async function cargarPanel() {
    if (actualizandoPanel) {
      return;
    }

    actualizandoPanel = true;

    try {
      const data = await api("/api/panel");

      $("#stat-waiting").textContent =
        data.resumen.esperando;

      $("#stat-completed").textContent =
        data.resumen.atendidos;

      $("#stat-absent").textContent =
        data.resumen.ausentes;

      $("#stat-total").textContent =
        data.resumen.total;

      if (data.actual) {
        $("#current-number").textContent =
          data.actual.numero;

        $("#current-name").textContent =
          data.actual.nombre;

        $("#current-service").textContent =
          data.actual.servicio;
      } else {
        $("#current-number").textContent = "—";

        $("#current-name").textContent =
          "No hay paciente llamado";

        $("#current-service").textContent = "";
      }

      const queueBody = $("#queue-body");

      queueBody.innerHTML = "";

      data.esperando.forEach(function (turno) {
        const fila = document.createElement("tr");

        fila.className = "priority-row";
        fila.setAttribute("role", "button");
        fila.setAttribute("tabindex", "0");

        let minutos = 0;

        const fechaCreacion =
          new Date(turno.creado).getTime();

        if (!Number.isNaN(fechaCreacion)) {
          minutos = Math.max(
            0,
            Math.floor(
              (Date.now() - fechaCreacion) / 60000
            )
          );
        }

        fila.appendChild(
          crearCelda(turno.numero)
        );

        fila.appendChild(
          crearCelda(turno.nombre)
        );

        fila.appendChild(
          crearCelda(turno.servicio)
        );

        fila.appendChild(
          crearCelda(minutos + " min")
        );

        const celdaAccion =
          document.createElement("td");

        celdaAccion.className =
          "queue-action-cell";

        const botonLlamar =
          document.createElement("button");

        botonLlamar.type = "button";
        botonLlamar.className = "priority-button";
        botonLlamar.textContent = "Llamar";

        botonLlamar.addEventListener(
          "click",
          function (event) {
            event.stopPropagation();
            llamarPrioritario(turno);
          }
        );

        celdaAccion.appendChild(botonLlamar);
        fila.appendChild(celdaAccion);

        fila.addEventListener(
          "click",
          function () {
            llamarPrioritario(turno);
          }
        );

        fila.addEventListener(
          "keydown",
          function (event) {
            if (
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();
              llamarPrioritario(turno);
            }
          }
        );

        queueBody.appendChild(fila);
      });

      $("#queue-empty").classList.toggle(
        "hidden",
        data.esperando.length > 0
      );

    } catch (error) {
      console.error(error);

      if (
        error.message === "Sesión requerida."
      ) {
        window.location.href = "/empleado";
      }

    } finally {
      actualizandoPanel = false;
    }
  }


  /* ----------------------------------------------------------
     ACCIÓN GENERAL
     ---------------------------------------------------------- */

  async function ejecutarAccion(url) {
    try {
      await api(url, {
        method: "POST"
      });

      await cargarPanel();

    } catch (error) {
      alert(error.message);
    }
  }


  /* ----------------------------------------------------------
     LLAMAR SIGUIENTE
     ---------------------------------------------------------- */

  const nextButton = $("#next");

  if (nextButton) {
    nextButton.addEventListener(
      "click",
      async function () {
        try {
          await api("/api/siguiente", {
            method: "POST"
          });

          beep();
          await cargarPanel();

        } catch (error) {
          alert(error.message);
        }
      }
    );
  }


  /* ----------------------------------------------------------
     VOLVER A LLAMAR
     ---------------------------------------------------------- */

  const recallButton = $("#recall");

  if (recallButton) {
    recallButton.addEventListener(
      "click",
      function () {
        const numero =
          $("#current-number").textContent.trim();

        if (numero === "—") {
          alert("No hay un turno actual.");
          return;
        }

        beep();

        alert(
          "Se volvió a llamar el turno " +
          numero
        );
      }
    );
  }


  /* ----------------------------------------------------------
     MARCAR AUSENTE
     ---------------------------------------------------------- */

  const absentButton = $("#absent");

  if (absentButton) {
    absentButton.addEventListener(
      "click",
      async function () {
        const numero =
          $("#current-number").textContent.trim();

        if (numero === "—") {
          alert("No hay un turno actual.");
          return;
        }

        const confirmado = window.confirm(
          "¿Desea marcar el turno " +
          numero +
          " como ausente?"
        );

        if (!confirmado) {
          return;
        }

        await ejecutarAccion(
          "/api/finalizar/ausente"
        );
      }
    );
  }


  /* ----------------------------------------------------------
     COMPLETAR TURNO
     ---------------------------------------------------------- */

  const completeButton = $("#complete");

  if (completeButton) {
    completeButton.addEventListener(
      "click",
      async function () {
        const numero =
          $("#current-number").textContent.trim();

        if (numero === "—") {
          alert("No hay un turno actual.");
          return;
        }

        const confirmado = window.confirm(
          "¿Desea completar el turno " +
          numero +
          "?"
        );

        if (!confirmado) {
          return;
        }

        await ejecutarAccion(
          "/api/finalizar/completado"
        );
      }
    );
  }


  /* ----------------------------------------------------------
     INICIAR PANEL
     ---------------------------------------------------------- */

  const employeePanel =
    $("#employee-panel");

  if (
    employeePanel &&
    !employeePanel.classList.contains("hidden")
  ) {
    cargarPanel();

    window.setInterval(
      cargarPanel,
      3000
    );
  }
}


/* ============================================================
   PANTALLA PÚBLICA
   ============================================================ */

if (page === "pantalla") {
  let ultimoLlamado = null;

  async function actualizarPantalla() {
    try {
      const data = await api("/api/actual");

      if (data.actual) {
        $("#screen-number").textContent =
          data.actual.numero;

        $("#screen-message").textContent =
          "Pase al área de servicio";

        $("#screen-service").textContent =
          data.actual.servicio;

        if (
          ultimoLlamado &&
          data.actual.llamado !== ultimoLlamado
        ) {
          beep();
        }

        ultimoLlamado =
          data.actual.llamado;
      } else {
        $("#screen-number").textContent = "—";

        $("#screen-message").textContent =
          "Espere a que llamen su turno";

        $("#screen-service").textContent = "";

        ultimoLlamado = null;
      }

    } catch (error) {
      console.error(error);
    }
  }

  actualizarPantalla();

  window.setInterval(
    actualizarPantalla,
    2000
  );
}