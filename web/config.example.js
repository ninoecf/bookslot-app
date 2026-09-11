// Copia este fichero a config.js para trabajar en local:
//
//     cp config.example.js config.js
//
// En AWS no hace falta: el pipeline escribe config.js con lo que devuelve
// `terraform output` justo antes de subir la interfaz a S3. Por eso config.js
// está en .gitignore — es un artefacto de despliegue, no código fuente.
//
// NINGUNO DE LOS TRES VALORES ES UN SECRETO. La URL de la API es pública, y el
// identificador del grupo de usuarios y el del cliente viajan en cualquier
// aplicación móvil o SPA del mundo: quien los tenga sigue necesitando una
// contraseña válida, que la custodia Cognito.
//
// La región no se pone aparte: la interfaz la deduce de `userPoolId`, que
// empieza por ella.
window.BOOKSLOT_CONFIG = {
  apiBaseUrl: "http://localhost:8080",

  // Para trabajar en local contra el Cognito de verdad, cópialos de
  // `terraform output cognito_user_pool_id` y `terraform output cognito_client_id`.
  // El registro y el acceso van SIEMPRE contra Cognito, también en local: no
  // hay un modo de mentira, así que estos dos tienen que ser reales.
  userPoolId: "eu-west-1_XXXXXXXXX",
  clientId: "xxxxxxxxxxxxxxxxxxxxxxxxxx"
};
