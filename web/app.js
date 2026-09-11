/* ===========================================================================
   BookSlot — SPA en JavaScript.
   =========================================================================== */

'use strict';

const CFG = window.BOOKSLOT_CONFIG || {};
const API = CFG.apiBaseUrl;

if (!API || !CFG.userPoolId || !CFG.clientId) {
  document.body.innerHTML =
      '<main><h1>Falta config.js</h1><p class="sub">Necesita <code>apiBaseUrl</code>, ' +
      '<code>userPoolId</code> y <code>clientId</code>. En local: ' +
      '<code>cp config.example.js config.js</code>. En AWS lo genera el pipeline.</p></main>';
  throw new Error('config.js ausente o incompleto');
}

const REGION = CFG.userPoolId.split('_')[0];
const COGNITO_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;

/* ---------------------------------------------------------------------------
   1. La sesión.
   El token vive en sessionStorage y NO en localStorage, y la diferencia
   importa: sessionStorage se borra al cerrar la pestaña, así que una sesión
   olvidada en un ordenador compartido no sobrevive.
   --------------------------------------------------------------------------- 
*/

const sesion = {
  get token() {
    return sessionStorage.getItem('token');
  },

  entrar(token) {
    sessionStorage.setItem('token', token);
  },

  salir() {
    sessionStorage.removeItem('token');
    ir('#/');
  },

  get activa() {
    return Boolean(this.token);
  },

  /**
   * Lee los grupos del token para decidir si se dibuja el menú de
   * administración.
   */
  get esAdmin() {
    const t = this.token;
    if (!t) return false;
    try {
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return (payload['cognito:groups'] || []).includes('admins');
    } catch {
      return false;
    }
  }
};

/* ---------------------------------------------------------------------------
   2. El cliente HTTP.
   --------------------------------------------------------------------------- */

/** Error con el código estable de la API dentro, para poder decidir con él. */
class ApiError extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

async function api(metodo, ruta, cuerpo, cabeceras) {
  const opciones = {
    method: metodo,
    headers: Object.assign({}, cabeceras)
  };

  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  if (sesion.activa) {
    opciones.headers['Authorization'] = 'Bearer ' + sesion.token;
  }

  const respuesta = await fetch(API + ruta, opciones);

  // 401 con sesión abierta significa token caducado. No hay refresh token —es
  // una simplificación consciente—, así que se limpia y se manda al login.
  if (respuesta.status === 401 && sesion.activa) {
    sessionStorage.removeItem('token');
    avisar('Tu sesión ha caducado. Vuelve a entrar.', true);
    ir('#/login');
    throw new ApiError('UNAUTHENTICATED', 'Sesión caducada', 401);
  }

  if (respuesta.status === 204) return null;

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    // La API devuelve SIEMPRE el mismo formato, {code, message, detail},
    // también en los 401 del authorizer. Por eso aquí no hay que distinguir
    // casos: se lee el mismo sitio pase lo que pase.
    throw new ApiError(
        (datos && datos.code) || 'INTERNAL_ERROR',
        (datos && datos.message) || 'Ha ocurrido un error.',
        respuesta.status);
  }

  return datos;
}

const get = (ruta) => api('GET', ruta);
const post = (ruta, cuerpo, cabeceras) => api('POST', ruta, cuerpo, cabeceras);
const del = (ruta) => api('DELETE', ruta);

/* ---------------------------------------------------------------------------
   2 bis. EL CLIENTE DE COGNITO
   --------------------------------------------------------------------------- */

/** Traduce los errores de Cognito, que llegan en `__type`, a algo legible. */
const ERRORES_COGNITO = {
  UsernameExistsException:     'Ya existe una cuenta con ese email.',
  NotAuthorizedException:      'Email o contraseña incorrectos.',
  UserNotFoundException:       'Email o contraseña incorrectos.',
  UserNotConfirmedException:   'Tu cuenta no está confirmada. Revisa tu email.',
  CodeMismatchException:       'El código no es correcto.',
  ExpiredCodeException:        'El código ha caducado. Pide uno nuevo.',
  InvalidPasswordException:    'La contraseña no cumple la política: mínimo 8 caracteres, con mayúscula, minúscula y número.',
  InvalidParameterException:   'Algún dato no es válido.',
  LimitExceededException:      'Demasiados intentos. Espera unos minutos.',
  TooManyRequestsException:    'Demasiados intentos. Espera unos minutos.',
  TooManyFailedAttemptsException: 'Demasiados intentos fallidos. Espera unos minutos.'
};

async function cognito(operacion, cuerpo) {
  const respuesta = await fetch(COGNITO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + operacion
    },
    body: JSON.stringify(Object.assign({ ClientId: CFG.clientId }, cuerpo))
  });

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    // `__type` viene como "com.amazonaws...#NotAuthorizedException": interesa
    // lo de después del almohadilla.
    const tipo = ((datos && datos.__type) || '').split('#').pop();
    // Se pasa el mensaje de Cognito sólo si no hay traducción: los suyos son
    // en inglés y a veces filtran detalles del pool.
    throw new ApiError(tipo || 'COGNITO_ERROR',
        ERRORES_COGNITO[tipo] || 'No se ha podido completar la operación.',
        respuesta.status);
  }

  return datos;
}

/* ---------------------------------------------------------------------------
   3. Utilidades de presentación.
   --------------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const app = $('#app');

function esc(texto) {
  return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fecha(iso, timezone) {
  const opciones = {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  };
  if (timezone) opciones.timeZone = timezone;
  return new Date(iso).toLocaleString('es-ES', opciones);
}

let temporizadorAviso;

function avisar(mensaje, esError) {
  const aviso = $('#aviso');
  aviso.textContent = mensaje;
  aviso.classList.toggle('error', Boolean(esError));
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 4000);
}

function ir(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ---------------------------------------------------------------------------
   4. Las pantallas.
   --------------------------------------------------------------------------- */

async function pantallaPortada() {
  app.innerHTML = '<h1>Qué puedes reservar</h1><p class="sub">Elige un recurso para ver sus horarios.</p><div id="lista">Cargando…</div>';

  const recursos = await get('/resources');

  $('#lista').innerHTML = recursos.length === 0
      ? '<p class="vacio">Todavía no hay nada publicado.</p>'
      : recursos.map((r) => `
          <div class="tarjeta">
            <a href="#/recurso/${esc(r.resourceId)}">
              <h3>${esc(r.name)}</h3>
              <p>${esc(r.description || '')}</p>
            </a>
          </div>`).join('');
}

/**
 * La pantalla del recurso
 *
 * Refresca el aforo cada 5 segundos con un `setInterval` que el router se
 * encarga de parar al cambiar de pantalla. Sin esa limpieza, cada visita
 * dejaría un temporizador vivo
 */
let refresco;

async function pantallaRecurso(resourceId) {
  const recurso = await get('/resources/' + resourceId);

  app.innerHTML = `
    <h1>${esc(recurso.name)}</h1>
    <p class="sub">${esc(recurso.description || '')}</p>
    <div id="franjas">Cargando horarios…</div>`;

  async function pintarFranjas() {
    let franjas;
    try {
      franjas = await get('/slots?resourceId=' + encodeURIComponent(resourceId));
    } catch {
      return; // un fallo puntual del refresco no debe borrar lo que se ve
    }

    const contenedor = $('#franjas');
    if (!contenedor) return; // ya hemos cambiado de pantalla

    contenedor.innerHTML = franjas.length === 0
        ? '<p class="vacio">No hay horarios próximos.</p>'
        : franjas.map((f) => {
            const agotado = f.remaining <= 0 || !f.open;
            return `
              <div class="tarjeta franja">
                <div>
                  <div class="cuando">${esc(fecha(f.startsAt, recurso.timezone))}</div>
                  <span class="aforo ${agotado ? 'agotado' : ''}">
                    ${agotado ? 'Sin plazas' : `${f.remaining} de ${f.capacity} libres`}
                  </span>
                </div>
                <button data-slot="${esc(f.slotId)}" ${agotado ? 'disabled' : ''}>
                  Reservar
                </button>
              </div>`;
          }).join('');

    contenedor.querySelectorAll('button[data-slot]').forEach((boton) => {
      boton.onclick = () => reservar(boton, pintarFranjas);
    });
  }

  await pintarFranjas();
  refresco = setInterval(pintarFranjas, 5000);
}

/**
 * LA RESERVA.
 */
async function reservar(boton, refrescar) {
  if (!sesion.activa) {
    sessionStorage.setItem('volverA', location.hash);
    ir('#/login');
    return;
  }

  const slotId = boton.dataset.slot;

  // UNA CLAVE DE IDEMPOTENCIA POR INTENTO DEL USUARIO.
  //
  // Se genera aquí, al pulsar, y se reutiliza si hay que reintentar por un
  // fallo de red. Esa es exactamente la garantía que da el servidor: la misma
  // clave devuelve la misma reserva en lugar de crear otra.
  //
  // Si se generara dentro del bucle de reintentos, cada reintento sería una
  // reserva nueva y la idempotencia no serviría para nada.
  const clave = crypto.randomUUID();

  boton.disabled = true;
  boton.textContent = 'Reservando…';

  try {
    const resultado = await post('/reservations', { slotId }, { 'Idempotency-Key': clave });
    avisar(`Reserva confirmada. Quedan ${resultado.remaining} plazas.`);
    await refrescar();

  } catch (e) {
    if (e.codigo === 'SLOT_SOLD_OUT') {
      // El caso que demuestra el proyecto entero. Se refresca el aforo
      // inmediatamente para que el usuario vea por qué le hemos dicho que no,
      // en lugar de dejarle mirando un botón que decía que quedaban plazas.
      avisar('Se han agotado las plazas mientras reservabas.', true);
      await refrescar();
    } else {
      avisar(e.message, true);
      boton.disabled = false;
      boton.textContent = 'Reservar';
    }
  }
}

async function pantallaMisReservas() {
  app.innerHTML = '<h1>Mis reservas</h1><div id="lista">Cargando…</div>';

  const reservas = await get('/reservations');

  /* LA RESERVA SE IDENTIFICA POR LA FRANJA, no por un identificador propio.
     
     Y no hay estado «cancelada»: cancelar BORRA la reserva, porque un item
     marcado como cancelada bloquearía volver a reservar esa misma franja.

     Se muestran los datos que la propia reserva lleva copiados dentro
     (`resourceName`, `startsAt`) */
  $('#lista').innerHTML = reservas.length === 0
      ? '<p class="vacio">Todavía no has reservado nada.</p>'
      : reservas.map((r) => `
            <div class="tarjeta franja">
              <div>
                <div class="cuando">${esc(r.resourceName || 'Recurso')}</div>
                <div class="cuando">${esc(fecha(r.startsAt, r.timezone))}</div>
                <span class="etiqueta">Confirmada · reservada el ${esc(fecha(r.createdAt))}</span>
              </div>
              <button class="peligro" data-cancelar="${esc(r.slotId)}">Cancelar</button>
            </div>`).join('');

  app.querySelectorAll('button[data-cancelar]').forEach((boton) => {
    boton.onclick = async () => {
      boton.disabled = true;
      try {
        await del('/reservations/' + boton.dataset.cancelar);
        avisar('Reserva cancelada. La plaza vuelve a estar disponible.');
        await pantallaMisReservas();
      } catch (e) {
        avisar(e.message, true);
        boton.disabled = false;
      }
    };
  });
}

function pantallaLogin() {
  app.innerHTML = `
    <h1>Entrar</h1>
    <p class="sub">¿No tienes cuenta? <a href="#/registro">Regístrate</a>.</p>
    <form id="f">
      <label for="email">Email</label>
      <input id="email" type="email" required autocomplete="email">
      <label for="password">Contraseña</label>
      <input id="password" type="password" required autocomplete="current-password">
      <button type="submit">Entrar</button>
    </form>`;

  $('#f').onsubmit = async (evento) => {
    evento.preventDefault();
    const boton = $('#f button');
    boton.disabled = true;
    try {
      // USER_PASSWORD_AUTH: la contraseña va a Cognito por HTTPS 
      const r = await cognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: $('#email').value,
          PASSWORD: $('#password').value
        }
      });

      if (!r.AuthenticationResult) {
        avisar('Tu cuenta necesita un paso adicional (' + (r.ChallengeName || 'desconocido') +
               ') que esta aplicación no cubre.', true);
        boton.disabled = false;
        return;
      }

      sesion.entrar(r.AuthenticationResult.IdToken);

      // Vuelve a donde estaba, si venía de intentar reservar.
      const destino = sessionStorage.getItem('volverA') || '#/';
      sessionStorage.removeItem('volverA');
      ir(destino);

    } catch (e) {
      avisar(e.message, true);
      boton.disabled = false;
      // Un usuario sin confirmar no puede entrar: se le lleva a poner el
      // código en lugar de dejarle reintentando la contraseña, que es
      // correcta.
      if (e.codigo === 'UserNotConfirmedException') {
        ir('#/confirmar?email=' + encodeURIComponent($('#email').value));
      }
    }
  };
}

function pantallaRegistro() {
  app.innerHTML = `
    <h1>Crear cuenta</h1>
    <p class="sub">Recibirás un correo de Amazon Cognito con el código para
      confirmar la cuenta.</p>
    <form id="f">
      <label for="fullName">Nombre completo</label>
      <input id="fullName" required autocomplete="name">
      <label for="email">Email</label>
      <input id="email" type="email" required autocomplete="email">
      <label for="password">Contraseña <span class="etiqueta">(mínimo 8, con mayúscula, minúscula y número)</span></label>
      <input id="password" type="password" minlength="8" required autocomplete="new-password">
      <button type="submit">Crear cuenta</button>
    </form>`;

  $('#f').onsubmit = async (evento) => {
    evento.preventDefault();
    const boton = $('#f button');
    boton.disabled = true;
    try {
      // `Username` es el email porque el pool tiene `username_attributes =
      // ["email"]`: no hay un nombre de usuario aparte que recordar.
      await cognito('SignUp', {
        Username: $('#email').value,
        Password: $('#password').value,
        UserAttributes: [
          { Name: 'email', Value: $('#email').value },
          { Name: 'name',  Value: $('#fullName').value }
        ]
      });
      avisar('Cuenta creada. Revisa tu email para el código.');
      ir('#/confirmar?email=' + encodeURIComponent($('#email').value));
    } catch (e) {
      avisar(e.message, true);
      boton.disabled = false;
    }
  };
}

function pantallaConfirmar(email) {
  app.innerHTML = `
    <h1>Confirmar cuenta</h1>
    <p class="sub">Escribe el código que has recibido en ${esc(email)}.</p>
    <form id="f">
      <label for="code">Código</label>
      <input id="code" required inputmode="numeric" autocomplete="one-time-code">
      <button type="submit">Confirmar</button>
    </form>
    <p class="sub">¿No te ha llegado? <a href="#" id="reenviar">Enviar otro código</a>.</p>`;

  $('#f').onsubmit = async (evento) => {
    evento.preventDefault();
    try {
      await cognito('ConfirmSignUp', {
        Username: email,
        ConfirmationCode: $('#code').value.trim()
      });
      avisar('Cuenta confirmada. Ya puedes entrar.');
      ir('#/login');
    } catch (e) {
      avisar(e.message, true);
    }
  };

  // Reenviar el código, que es la pregunta inmediata de cualquiera que no lo
  // reciba. Tres líneas y evita que la cuenta quede inservible.
  $('#reenviar').onclick = async (evento) => {
    evento.preventDefault();
    try {
      await cognito('ResendConfirmationCode', { Username: email });
      avisar('Te hemos enviado un código nuevo.');
    } catch (e) {
      avisar(e.message, true);
    }
  };
}

/**
 * Administración: crear recursos y franjas.
 *
 * Cada franja se crea con su aforo en una sola llamada: en la tabla son un
 * único item, así que no puede existir una franja sin aforo ni un instante.
 */
async function pantallaAdmin() {
  const recursos = await get('/resources');

  app.innerHTML = `
    <h1>Administración</h1>
    <p class="sub">Crear recursos reservables y sus franjas horarias.</p>

    <h2>Nuevo recurso</h2>
    <form id="fRecurso">
      <label for="name">Nombre</label>
      <input id="name" required>
      <label for="description">Descripción</label>
      <input id="description">
      <label for="timezone">Zona horaria</label>
      <input id="timezone" value="Europe/Madrid">
      <button type="submit">Crear recurso</button>
    </form>

    <h2>Nueva franja</h2>
    <form id="fFranja">
      <label for="resourceId">Recurso</label>
      <select id="resourceId" required>
        ${recursos.map((r) => `<option value="${esc(r.resourceId)}">${esc(r.name)}</option>`).join('')}
      </select>
      <label for="startsAt">Empieza</label>
      <input id="startsAt" type="datetime-local" required>
      <label for="endsAt">Termina</label>
      <input id="endsAt" type="datetime-local" required>
      <label for="capacity">Aforo</label>
      <input id="capacity" type="number" min="1" value="3" required>
      <button type="submit" ${recursos.length === 0 ? 'disabled' : ''}>Crear franja</button>
    </form>`;

  $('#fRecurso').onsubmit = async (evento) => {
    evento.preventDefault();
    try {
      await post('/admin/resources', {
        name: $('#name').value,
        description: $('#description').value || null,
        timezone: $('#timezone').value
      });
      avisar('Recurso creado.');
      await pantallaAdmin();
    } catch (e) {
      avisar(e.message, true);
    }
  };

  $('#fFranja').onsubmit = async (evento) => {
    evento.preventDefault();
    try {
      await post('/admin/slots', {
        resourceId: $('#resourceId').value,
        // El input datetime-local da hora local sin zona; la API espera un
        // instante en UTC. `new Date(...)` la interpreta en la zona del
        // navegador y `toISOString()` la pasa a UTC.
        startsAt: new Date($('#startsAt').value).toISOString(),
        endsAt: new Date($('#endsAt').value).toISOString(),
        capacity: Number($('#capacity').value)
      });
      avisar('Franja creada con su aforo.');
    } catch (e) {
      avisar(e.message, true);
    }
  };
}

/* ---------------------------------------------------------------------------
   5. El router.

   Rutas de hash y no del History API a propósito: con hash, el navegador nunca
   pide al servidor una URL que no existe, así que CloudFront no necesita
   ninguna regla de error que reescriba a index.html.
   --------------------------------------------------------------------------- */

const RUTAS = [
  [/^#\/$/,                     () => pantallaPortada()],
  [/^#\/recurso\/(.+)$/,        (m) => pantallaRecurso(m[1])],
  [/^#\/login$/,                () => pantallaLogin()],
  [/^#\/registro$/,             () => pantallaRegistro()],
  [/^#\/confirmar\?email=(.+)$/, (m) => pantallaConfirmar(decodeURIComponent(m[1]))],
  [/^#\/mis-reservas$/,         () => pantallaMisReservas(),  true],
  [/^#\/admin$/,                () => pantallaAdmin(),        true]
];

function pintarMenu() {
  $('#nav').innerHTML = sesion.activa
      ? `<a href="#/">Recursos</a>
         <a href="#/mis-reservas">Mis reservas</a>
         ${sesion.esAdmin ? '<a href="#/admin">Admin</a>' : ''}
         <a href="#" id="salir">Salir</a>`
      : `<a href="#/">Recursos</a><a href="#/login">Entrar</a>`;

  const salir = $('#salir');
  if (salir) {
    salir.onclick = (evento) => { evento.preventDefault(); sesion.salir(); };
  }
}

async function render() {
  // Parar el refresco de aforo de la pantalla anterior. Si esto faltara, cada
  // visita a un recurso dejaría un temporizador vivo para siempre.
  clearInterval(refresco);

  const hash = location.hash || '#/';
  pintarMenu();

  for (const [patron, pantalla, requiereSesion] of RUTAS) {
    const coincidencia = hash.match(patron);
    if (!coincidencia) continue;

    if (requiereSesion && !sesion.activa) {
      sessionStorage.setItem('volverA', hash);
      return ir('#/login');
    }

    try {
      return await pantalla(coincidencia);
    } catch (e) {
      // Un 401 ya ha redirigido por su cuenta; el resto se enseña.
      if (e.status !== 401) {
        app.innerHTML = `<p class="vacio">${esc(e.message)}</p>`;
      }
      return;
    }
  }

  app.innerHTML = '<p class="vacio">Esta página no existe. <a href="#/">Volver al inicio</a>.</p>';
}

window.addEventListener('hashchange', render);
render();
