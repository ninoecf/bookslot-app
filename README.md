# bookslot-app
Bookslot app

Plataforma de reservas con aforo limitado sobre AWS, desplegada íntegramente con Terraform.

El requisito central es que **no se pueda vender la misma plaza dos veces**: con N peticiones simultáneas sobre M plazas se confirman exactamente M reservas y el resto recibe `409 SLOT_SOLD_OUT`. Todo lo demás del proyecto existe para sostener esa garantía y para demostrarla.

Proyecto académico. Arquitectura *serverless*: no hay servidores que administrar y el coste no depende del tiempo que la infraestructura lleve creada.

---

## 1. Descripción funcional

Un administrador publica **recursos** (una sala, una clase, una mesa) y, para cada uno, **franjas horarias con un aforo**. Cualquier visitante puede consultar el catálogo y las plazas disponibles sin registrarse. Un usuario registrado reserva una plaza en una franja y puede cancelarla.

**Reglas de negocio:**

- Una franja no admite más reservas que su aforo, ni con peticiones simultáneas.
- Un usuario tiene como máximo una reserva activa por franja.
- Una franja cerrada no admite reservas.
- Reintentar la misma petición de reserva no crea una segunda: el cliente envía una cabecera `Idempotency-Key` y una repetición devuelve la reserva original.
- Cancelar libera la plaza inmediatamente.

**Dos perfiles:**

| Perfil | Puede |
|---|---|
| Visitante | Consultar recursos y franjas con su disponibilidad |
| Usuario registrado | Reservar, ver sus reservas, cancelar, editar su perfil |
| Administrador | Todo lo anterior, más crear recursos y franjas |

La interfaz es una única aplicación web con los dos paneles —usuario y administración— y navegación por rutas *hash*.

---

## 2. Arquitectura

![Arquitectura de BookSlot](docs/diagrams/diagram.svg)

| Componente | Servicio | Función |
|---|---|---|
| Entrega de la interfaz | S3 + CloudFront | HTTPS sobre un *bucket* privado, accesible solo por OAC |
| Identidad | Amazon Cognito | Custodia las contraseñas y emite el JWT |
| Entrada a la API | API Gateway HTTP API | Valida el JWT con un *authorizer* nativo antes de invocar la función |
| Lógica | AWS Lambda (Node.js, arm64) | Un fichero, sin dependencias y sin paso de compilación |
| Datos | Amazon DynamoDB | Una sola tabla con un índice global; aquí se decide la plaza |
| Copias de seguridad | PITR de DynamoDB | 35 días con granularidad de segundo |
| Aviso de reserva | SNS con filtro por suscripción | Correo al cliente al confirmar y al cancelar (si sumla en el log de cloudwatch, lo ejecuta una lambda ya que no se puede utilizar Amazon SES por reestricciones de cuenta) |
| Observabilidad y coste | CloudWatch + AWS Budgets | Logs, métricas, **cuatro alarmas** y control de gasto |

### API Gateway
 
Una **HTTP API**, no una REST API: cuesta unas tres veces menos por petición y trae *authorizer* JWT nativo, así que la firma, el emisor, la audiencia y la caducidad se comprueban **antes** de invocar la función.
 
Las rutas se declaran una a una y no con un comodín `$default`, porque el authorizer se asigna **por ruta**: es lo que permite que el catálogo sea público y el resto exija token.
 
| Ruta | Acceso |
|---|---|
| `GET /resources` · `GET /resources/{resourceId}` · `GET /slots` | Público |
| `POST` · `GET /reservations` · `DELETE /reservations/{slotId}` · `GET` · `PUT /me` | Token válido |
| `POST /admin/resources` · `POST /admin/slots` | Token válido + grupo `admins` |
 
El gateway autentica; que el usuario sea administrador lo decide la función leyendo `cognito:groups`.

### DynamoDB

Una sola tabla, `bookslot`, con un índice global. Modo **on-demand** (no hay capacidad que dimensionar) y **PITR activado**, que es el requisito de backups.

| Item | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| **Recurso** | `RESOURCE#<rid>` | `META` | `RESOURCES` | `<name>` |
| **Franja + aforo** | `SLOT#<sid>` | `META` | `RESOURCE#<rid>` | `<startsAt>` |
| **Reserva** | `SLOT#<sid>` | `RES#<uid>` | `USER#<uid>` | `<createdAt>` |
| **Perfil** | `USER#<uid>` | `PROFILE` | — | — |
| **Idempotencia** | `IDEM#<uid>#<key>` | `IDEM` | — | — |


---

## 3. Decisión arquitectónica

**La decisión: serverless gestionado, sin red propia.** API Gateway, Lambda y DynamoDB. Simplifica la construcción de la infraestructura y reduce los costes, aprox. de ~200€ a ~1€ al mes (Lo que es la infraestructura sin tener en cuenta el volumen).

**Por qué:**

1. **La garantía de aforo se simplifica con DynamoDB.** `TransactWriteItems` de DynamoDB da una operación ACID con condiciones sobre varios items. La alternativa relacional exigía una transacción de dos sentencias, un índice único parcial, una restricción `CHECK` y traducir el código de error de PostgreSQL leyendo el nombre de la restricción en el texto del mensaje. Menos piezas para la misma garantía.
2. **La superficie de infraestructura se reduce a un tercio.** Desaparecen la VPC, tres capas de subredes, los NACL, los *security groups*, el NAT Gateway, el balanceador interno, el VPC Link, el registro de imágenes y el clúster de contenedores. Todos existían para aislar la base de datos, no para dar función.
3. **El coste deja de depender del tiempo encendido.** Sin instancias ni contenedores en marcha, no hace falta destruir la infraestructura entre sesiones de trabajo para no pagarla.
4. **No hay artefacto que construir.** La función es un fichero que Terraform empaqueta durante el `apply`, así que el despliegue no depende de una compilación previa ni de publicar una imagen.

**Qué se pierde:**

- **DynamoDB no es SQL.** Cada consulta tiene que estar prevista en el diseño de las claves: no se puede improvisar un `WHERE` nuevo sobre datos ya escritos. 

- **La vista de disponibilidad es de consistencia eventual**, porque se lee por el índice. La reserva no va contra la tabla base con lectura consistente.
- **Algunos datos están duplicados a propósito.** La reserva guarda copia del nombre del recurso y de la hora para que el aviso no tenga que consultarlos.

### Alta disponibilidad

Aprovechando servicios serverless de forma natural se justifica como cubren la Alta disponibilidad:

| Componente | Qué pasa si cae una zona de disponibilidad |
|---|---|
| DynamoDB | Nada. Cada partición se replica de forma sincrónica en **tres** zonas y el liderazgo se traspasa solo |
| Lambda | Nada. AWS invoca la función en las zonas que quedan |
| API Gateway | Nada. El endpoint es regional |
| Cognito | Nada. Regional |
| CloudFront + S3 | Nada. CloudFront es global y S3 replica dentro de la región |

### Overbooking e Idempotencia

**Cómo se evita el overbooking, en una frase:** la reserva es una única operación `TransactWriteItems` de DynamoDB cuya condición `reserved_count < capacity` la evalúa el líder de la partición en el mismo paso indivisible en el que escribe.

No hay una comprobación previa en el código que un fallo pueda saltarse: es la propia escritura la que no se produce.

La reserva es **una sola operación transaccional** con tres condiciones que se cumplen todas o no se escribe nada:

1. quedan plazas y la franja está abierta — `reserved_count < capacity AND status = OPEN`
2. el usuario no tiene ya una reserva en esa franja — la clave del item lo impide por construcción
3. la clave de idempotencia no se había usado — un reintento devuelve la reserva original



Se comprueba a dos alturas:

| Prueba | Qué demuestra |
|---|---|
| `scripts/concurrency-test.sh` | N reservas simultáneas por HTTPS contra el despliegue real |
| `scripts/idempotency-test.sh` | 20 peticiones con la misma clave producen una sola reserva |

---

## 4. Seguridad y operación
 
**IAM con mínimo privilegio.** Al utilizar serverless se configuran los recursos con los roles de la academia, y se configura de forma que los recursos no tienen permisos ilimitados, ni nos encontramos con "*" en los servicios.
 
**Secretos fuera del código: no hay ninguno.** Los clientes se almacenan con Cognito, y los pipelines no almacenan claves de AWS.
 
**HTTPS.** Los dos puntos expuestos, CloudFront y el endpoint de API Gateway, solo aceptan HTTPS. El *bucket* no es accesible directamente: solo CloudFront, por OAC.
 
**CI/CD.** `ci.yml` corre en cada push y pull request las pruebas de la función, `terraform fmt -check`, `terraform validate` y la sintaxis de la interfaz, **sin ningún acceso a AWS**. `deploy.yml` despliega en push a `main` por **OIDC**, sin claves almacenadas: `terraform apply`, generar `config.js` con los *outputs*, subir la interfaz e invalidar la caché.
 
**Alarmas.** Las alarmas se publican en un topic de SNS **suscrito a un correo**. Se evaluan los errores 5xx.
 
**FinOps.** Los tags `Project`, `Environment` y `Owner` los aplica el provider con `default_tags`. **AWS Budgets** avisa por correo al superar el presupuesto mensual configurado.
 
---

## 4. Instrucciones de despliegue


---

## 5. Instrucciones de destrucción


---

## 6. Coste mensual estimado

Sin nada encendido por horas, el gasto depende del uso. Con el de este proyecto —despliegues, pruebas y una demostración— las líneas quedan así:

| Concepto | Estimación mensual |
|---|---|
| Lambda | 0 $ · dentro del tramo gratuito permanente (1 M de invocaciones) |
| API Gateway HTTP API | céntimos · 1,00 $ por millón de peticiones |
| DynamoDB (peticiones on-demand) | céntimos · 1,25 $ por millón de escrituras |
| DynamoDB (almacenamiento y PITR) | céntimos · el volumen de datos es de kilobytes |
| S3 + CloudFront | 0 $ · dentro del tramo gratuito permanente |
| Cognito | 0 $ · muy por debajo del umbral de usuarios activos |
| CloudWatch Logs | céntimos · según la retención configurada |
| SNS | céntimos |
| **Total** | **por debajo de 1 $/mes** |

### Escenario con tráfico real

Estimación hecha con la [calculadora oficial de AWS](https://calculator.aws/#/estimate?nc2=h_pr_calc&id=2bf144db3d84c40d04d5fe88fdd64ef9471cacd3) sobre un escenario de **50 visitas, 10 reservas y 10 registros al día** : **0,50 $/mes**. El desglose exportado está en [`docs/coste-estimado.json`](docs/coste-estimado.json).
 
De esos 0,50 $, **0,43 $ son las cuatro alarmas de CloudWatch computadas sin la capa gratuita** —la calculadora avisa de que esa sección la excluye—, y en la práctica las diez primeras alarmas son gratis. La cifra es el techo, no el suelo.

