// Lambda Bookslot API
// Handler: index.handler
// Runtime: Node.js 24
// Aquí encontramos en forma monolitica toda la aplicación.
// Aclaración, no es que me guste hacerlo así, pero no tengo mucho más tiempo.
 
import {
    DynamoDBClient, GetItemCommand, PutItemCommand,
    QueryCommand, TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
 
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
 
// Fuera del handler: La Lambda reutiliza el contenedor entre invocaciones, así las credenciales y
//  el TLS se resuelven una vez y no en cada petición.
const ddb = new DynamoDBClient({});
const sns = new SNSClient({});
 
const TABLE = process.env.TABLE_NAME;
const TOPIC = process.env.TOPIC_ARN;
const INDEX = "GSI1";
 
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 
// Las claves de idempotencia sirven para reintentar un fallo de red. A las 24 h el TTL de la tabla las borra solo.
const IDEM_TTL_SECONDS = 24 * 60 * 60;
 
//---------------------------------------------------------------------------
// LOS ENDPOINTS
//---------------------------------------------------------------------------
 
const ROUTES = {
    "POST /register": register,
 
    "GET /resources": listResources,
    "GET /resources/{resourceId}": getResource,
    "GET /slots": listSlots,
 
    "POST /reservations": reserve,
    "GET /reservations": myReservations,
    "DELETE /reservations/{slotId}": cancel,
 
    "POST /admin/resources": createResource,
    "POST /admin/slots": createSlot,
};
 
export const handler = async (event) => {
    const p = request(event);
 
    try {
        const handlerFn = ROUTES[p.route];
        if (!handlerFn) fail("NOT_FOUND");
        return await handlerFn(p);
    } catch (err) {
        if (err instanceof BusinessError) {
            const [status, message] = ERROR_CATALOG[err.code] ?? ERROR_CATALOG.INTERNAL_ERROR;
            return json(status, { code: err.code, message: message, detail: err.detail ?? null });
        }
 
        if (err.name === "ProvisionedThroughputExceededException" ||
            err.name === "RequestLimitExceeded" ||
            err.name === "ThrottlingException") {
            const [status, message] = ERROR_CATALOG.TOO_MANY_REQUESTS;
            return json(status, { code: "TOO_MANY_REQUESTS", message: message });
        }
 
        console.error("error no controlado", { route: p.route, nombre: err.name, message: err.message });
        return json(500, { code: "INTERNAL_ERROR", message: ERROR_CATALOG.INTERNAL_ERROR[1] });
    }
};
 
// ---------------------------------------------------------------------------
// EL CATÁLOGO DE ERRORES
// ---------------------------------------------------------------------------
 
const ERROR_CATALOG = {
    VALIDATION_ERROR: [400, "La petición no es válida."],
    UNAUTHENTICATED: [401, "Necesitas iniciar sesión."],
    FORBIDDEN: [403, "No tienes permiso para hacer esto."],
    NOT_FOUND: [404, "No se ha encontrado."],
    SLOT_SOLD_OUT: [409, "No quedan plazas en esta franja."],
    ALREADY_RESERVED: [409, "Ya tienes una plaza reservada en esta franja."],
    SLOT_BLOCKED: [409, "Esta franja no admite reservas."],
    TOO_MANY_REQUESTS: [429, "Demasiadas peticiones, inténtalo en unos segundos."],
    INTERNAL_ERROR: [500, "Ha ocurrido un error inesperado."],
};
 
class BusinessError extends Error {
    constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
 
const fail = (code, detail) => { throw new BusinessError(code, detail); };
 
const json = (status, body) => ({
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "" : JSON.stringify(body),
});
 
const toAttr = (v) =>
    typeof v === "number" ? { N: String(v) } :
    typeof v === "boolean" ? { BOOL: v } :
    { S: String(v) };
 
const toItem = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null).map(([k, v]) => [k, toAttr(v)]),
);
 
const fromAttr = (a) => "S" in a ? a.S : "N" in a ? Number(a.N) : "BOOL" in a ? a.BOOL : null;
 
const fromItem = (item) =>
    item ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, fromAttr(v)])) : null;
 
const request = (event) => {
    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    const raw = claims["cognito:groups"];
    const groups = Array.isArray(raw) ? raw
        : typeof raw === "string" ? raw.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean)
        : [];
 
    return {
        route: event.routeKey,
        param: (n) => event.pathParameters?.[n],
        query: (n) => event.queryStringParameters?.[n],
        /* Las cabeceras llegan siempre en minúsculas en el payload 2.0. */
        header: (n) => event.headers?.[n.toLowerCase()],
        body: () => {
            if (!event.body) return {};
            try {
                const c = JSON.parse(event.isBase64Encoded
                    ? Buffer.from(event.body, "base64").toString("utf8")
                    : event.body);
                if (c === null || typeof c !== "object" || Array.isArray(c)) {
                    fail("VALIDATION_ERROR", "el cuerpo no es un objeto JSON");
                }
                return c;
            } catch (err) {
                if (err instanceof BusinessError) throw err;
                fail("VALIDATION_ERROR", "el cuerpo no es JSON válido");
            }
        },
        userId: claims.sub,
        email: claims.email,
        isAdmin: groups.includes("admins"),
    };
};
 
const requireAuth = (p) => { if (!p.userId) fail("UNAUTHENTICATED"); };
const requireAdmin = (p) => { if (!p.isAdmin) fail("FORBIDDEN"); };
 
const requireText = (value, field) => {
    if (typeof value !== "string" || value.trim() === "") fail("VALIDATION_ERROR", `falta ${field}`);
    return value.trim();
};
 
const requireEmail = (value, field) => {
    const v = requireText(value, field);
    if (!EMAIL_PATTERN.test(v)) fail("VALIDATION_ERROR", `${field} no es una dirección válida`);
    return v;
};
 
const requireInt = (value, field, min) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) fail("VALIDATION_ERROR", `${field} debe ser un entero >= ${min}`);
    return n;
};
 
const requireDate = (value, field) => {
    const t = Date.parse(requireText(value, field));
    if (Number.isNaN(t)) fail("VALIDATION_ERROR", `${field} no es una fecha ISO-8601`);
    return new Date(t).toISOString();
};
 
const resourceView = (i) => ({
    resourceId: i.resourceId, name: i.name, description: i.description ?? null,
    timezone: i.timezone, active: i.active,
});
 
const slotView = (i) => ({
    slotId: i.slotId, resourceId: i.resourceId, startsAt: i.startsAt, endsAt: i.endsAt,
    capacity: i.capacity,
    remaining: Math.max(0, i.capacity - i.reserved_count),
    open: i.status === "OPEN" && i.reserved_count < i.capacity,
});
 
const reservationView = (i) => ({
    slotId: i.slotId, userId: i.userId, userEmail: i.userEmail, status: i.status,
    createdAt: i.createdAt, resourceId: i.resourceId, resourceName: i.resourceName,
    startsAt: i.startsAt, endsAt: i.endsAt, timezone: i.timezone,
});
 
const readItem = async (pk, sk) => {
    const r = await ddb.send(new GetItemCommand({
        TableName: TABLE, Key: { PK: { S: pk }, SK: { S: sk } }, ConsistentRead: true,
    }));
    return fromItem(r.Item);
};
 
const queryIndex = async (gsi1pk, extra = {}) => {
    const r = await ddb.send(new QueryCommand({
        TableName: TABLE, IndexName: INDEX, ...extra,
        KeyConditionExpression: extra.KeyConditionExpression ?? "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": { S: gsi1pk }, ...(extra.ExpressionAttributeValues ?? {}) },
    }));
    return (r.Items ?? []).map(fromItem);
};
 
// ---------------------------------------------------------------------------
// LA TRANSACCIÓN, CON REINTENTO.
// ---------------------------------------------------------------------------
 
const RETRYABLE = new Set(["TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded"]);
const ATTEMPTS = 4;
const BASE_DELAY_MS = 25;
 
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
 
const transaction = async (items) => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await ddb.send(new TransactWriteItemsCommand({ TransactItems: items }));
        } catch (err) {
            if (err.name !== "TransactionCanceledException") throw err;
 
            const reasons = (err.CancellationReasons ?? []).map((r) => r?.Code);
            if (reasons.includes("ConditionalCheckFailed")) throw err;
 
            const onlyContention =
                reasons.some((c) => RETRYABLE.has(c)) &&
                reasons.every((c) => c === "None" || c === undefined || RETRYABLE.has(c));
 
            if (!onlyContention || attempt >= ATTEMPTS) {
                if (onlyContention) {
                    console.warn("contención persistente en la transacción", { reasons, attempt });
                    fail("TOO_MANY_REQUESTS");
                }
                throw err;
            }
 
            const ceiling = BASE_DELAY_MS * 2 ** (attempt - 1);
            await sleep(ceiling / 2 + Math.random() * (ceiling / 2));
        }
    }
};
 
// ---------------------------------------------------------------------------
// EL AVISO
// Publica en SNS y ahí se acaba su responsabilidad: quien lo recibe es la Lambda notificadora, que simula el envío del correo.
//---------------------------------------------------------------------------

const notify = async (type, email, subject, body, userId = null) => {
    if (!TOPIC) { console.error("Falta la variable de entorno TOPIC_ARN"); return; }
    try {
        const r = await sns.send(new PublishCommand({
            TopicArn: TOPIC,
            Subject: subject.slice(0, 99), // SNS corta el asunto en 100 caracteres
            Message: JSON.stringify({ event: type, userId, email, subject: subject, body: body }),
        }));
        console.log("Mensaje publicado en SNS. MessageId:", r.MessageId);
    } catch (err) {
        console.error("Error publicando en SNS:", err.name, err.message);
    }
};
 
// La hora SIEMPRE en la zona del recurso, nunca en UTC ni en la de la Lambda.
const inLocalTime = (iso, zone) => {
    try {
        return new Intl.DateTimeFormat("es-ES", {
            dateStyle: "full", timeStyle: "short", timeZone: zone || "UTC",
        }).format(new Date(iso));
    } catch {
        return iso;
    }
};
 
// ==========================================================================
// RUTAS PÚBLICAS, sin token
// ==========================================================================
 
async function register(p) {
    const c = p.body();
    const name = requireText(c.name, "name");
    const email = requireEmail(c.email, "email");
 
    await notify("USER_REGISTERED", email, "Nuevo usuario registrado",
        `Bienvenido a BookSlot, ${name}.\n\nYa puedes reservar plaza desde la aplicación.`);
 
    return json(200, { message: "User registered and notification sent" });
}
 
async function listResources() {
    const items = await queryIndex("RESOURCES", {
        FilterExpression: "#activo = :si",
        ExpressionAttributeNames: { "#activo": "active" },
        ExpressionAttributeValues: { ":si": { BOOL: true } },
    });
    return json(200, items.map(resourceView));
}
 
async function getResource(p) {
    const r = await readItem(`RESOURCE#${requireText(p.param("resourceId"), "resourceId")}`, "META");
    if (!r || !r.active) fail("NOT_FOUND");
    return json(200, resourceView(r));
}
 
async function listSlots(p) {
    const resourceId = requireText(p.query("resourceId"), "resourceId");
    const items = await queryIndex(`RESOURCE#${resourceId}`, {
        KeyConditionExpression: "GSI1PK = :pk AND GSI1SK >= :ahora",
        ExpressionAttributeValues: { ":ahora": { S: new Date().toISOString() } },
    });
    return json(200, items.map(slotView));
}
 
//===========================================================================
// RESERVAS
// ===========================================================================
 
async function reserve(p) {
    requireAuth(p);
    const key = requireText(p.header("Idempotency-Key"), "la cabecera Idempotency-Key");
    const slotId = requireText(p.body().slotId, "slotId");
    const { userId, email } = p;
 
    const slot = await readItem(`SLOT#${slotId}`, "META");
    if (!slot) fail("NOT_FOUND");
 
    const now = new Date().toISOString();
    const reservation = {
        PK: `SLOT#${slotId}`, SK: `RES#${userId}`,
        GSI1PK: `USER#${userId}`, GSI1SK: now,
        slotId, userId, userEmail: email, status: "CONFIRMED", createdAt: now,
        resourceId: slot.resourceId, resourceName: slot.resourceName,
        startsAt: slot.startsAt, endsAt: slot.endsAt, timezone: slot.timezone,
    };
 
    try {
        await transaction([
            {   // 0 - LA PLAZA 
                Update: {
                    TableName: TABLE,
                    Key: { PK: { S: `SLOT#${slotId}` }, SK: { S: "META" } },
                    UpdateExpression: "SET #reservadas = #reservadas + :uno",
                    ConditionExpression: "attribute_exists(PK) AND #estado = :abierta AND #reservadas < #aforo",
                    ExpressionAttributeNames: { "#reservadas": "reserved_count", "#aforo": "capacity", "#estado": "status" },
                    ExpressionAttributeValues: { ":uno": { N: "1" }, ":abierta": { S: "OPEN" } },
                },
            },
            {   // 1 - LA RESERVA 
                Put: {
                    TableName: TABLE, Item: toItem(reservation),
                    ConditionExpression: "attribute_not_exists(SK)",
                },
            },
            {   // 2 - LA IDEMPOTENCIA
                Put: {
                    TableName: TABLE,
                    Item: toItem({
                        PK: `IDEM#${userId}#${key}`, SK: "IDEM", slotId, createdAt: now,
                        ttl: Math.floor(Date.now() / 1000) + IDEM_TTL_SECONDS,
                    }),
                    ConditionExpression: "attribute_not_exists(PK)",
                },
            },
        ]);
    } catch (err) {
        if (err.name !== "TransactionCanceledException") throw err;
        return await explainCancellation(err, userId, key, slotId);
    }
 
    await notify("RESERVATION_CONFIRMED", email, `Reserva confirmada · ${reservation.resourceName}`, [
        `Tu reserva está confirmada.`,
        ``,
        `Recurso: ${reservation.resourceName}`,
        `Comienza: ${inLocalTime(reservation.startsAt, reservation.timezone)}`,
        `Termina:  ${inLocalTime(reservation.endsAt, reservation.timezone)}`,
        ``,
        `Puedes cancelarla desde la aplicación.`,
    ].join("\n"), userId);
 
    return json(201, { reservation: reservationView(reservation), remaining: slot.capacity - slot.reserved_count - 1 });
}
 
async function explainCancellation(err, userId, key, slotId) {
    const reasons = err.CancellationReasons ?? [];
    const failed = (i) => reasons[i]?.Code === "ConditionalCheckFailed";
 
    if (failed(2)) {
        const idem = await readItem(`IDEM#${userId}#${key}`, "IDEM");
        const reservation = idem && await readItem(`SLOT#${idem.slotId}`, `RES#${userId}`);
        if (reservation) {
            const slot = await readItem(`SLOT#${idem.slotId}`, "META");
            return json(200, {
                reservation: reservationView(reservation),
                remaining: slot ? Math.max(0, slot.capacity - slot.reserved_count) : 0,
            });
        }
        fail("VALIDATION_ERROR", "esa Idempotency-Key ya se usó para una reserva que ya no existe");
    }
 
    if (failed(1)) fail("ALREADY_RESERVED");
 
    if (failed(0)) {
        const slot = await readItem(`SLOT#${slotId}`, "META");
        if (!slot) fail("NOT_FOUND");
        if (slot.status !== "OPEN") fail("SLOT_BLOCKED");
        fail("SLOT_SOLD_OUT");
    }
 
    throw err;
}
 
async function myReservations(p) {
    requireAuth(p);
    const items = await queryIndex(`USER#${p.userId}`, { ScanIndexForward: false });
    return json(200, items.map(reservationView));
}
 
async function cancel(p) {
    requireAuth(p);
    const slotId = requireText(p.param("slotId"), "slotId");
 
    const reservation = await readItem(`SLOT#${slotId}`, `RES#${p.userId}`);
    if (!reservation) fail("NOT_FOUND");
 
    try {
        await transaction([
            {
                Update: {
                    TableName: TABLE,
                    Key: { PK: { S: `SLOT#${slotId}` }, SK: { S: "META" } },
                    UpdateExpression: "SET #reservadas = #reservadas - :uno",
                    ConditionExpression: "#reservadas > :cero",
                    ExpressionAttributeNames: { "#reservadas": "reserved_count" },
                    ExpressionAttributeValues: { ":uno": { N: "1" }, ":cero": { N: "0" } },
                },
            },
            {
                Delete: {
                    TableName: TABLE,
                    Key: { PK: { S: `SLOT#${slotId}` }, SK: { S: `RES#${p.userId}` } },
                    ConditionExpression: "attribute_exists(SK)",
                },
            },
        ]);
    } catch (err) {
        if (err.name !== "TransactionCanceledException") throw err;
        const reasons = (err.CancellationReasons ?? []).map((r) => r?.Code);
 
        if (reasons[1] === "ConditionalCheckFailed") fail("NOT_FOUND");
        if (reasons[0] === "ConditionalCheckFailed") {
            console.error("contador incoherente al cancelar", { slotId, userId: p.userId });
            fail("INTERNAL_ERROR");
        }
        throw err;
    }
 
    await notify("RESERVATION_CANCELLED", p.email, `Reserva cancelada · ${reservation.resourceName}`, [
        `Tu reserva ha quedado cancelada y la plaza vuelve a estar libre.`,
        ``,
        `Recurso: ${reservation.resourceName}`,
        `Era el: ${inLocalTime(reservation.startsAt, reservation.timezone)}`,
    ].join("\n"), p.userId);
 
    return json(204);
}
 
//===========================================================================
// ADMINISTRACIÓN
// ===========================================================================
 
async function createResource(p) {
    requireAdmin(p);
    const c = p.body();
    const name = requireText(c.name, "name");
    const resourceId = crypto.randomUUID();
 
    const resource = {
        PK: `RESOURCE#${resourceId}`, SK: "META", GSI1PK: "RESOURCES", GSI1SK: name,
        resourceId, name,
        description: c.description ? String(c.description) : undefined,
        timezone: c.timezone ? String(c.timezone) : "Europe/Madrid",
        active: true,
    };
 
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: toItem(resource) }));
    return json(201, resourceView(resource));
}
 
async function createSlot(p) {
    requireAdmin(p);
    const c = p.body();
    const resourceId = requireText(c.resourceId, "resourceId");
    const startsAt = requireDate(c.startsAt, "startsAt");
    const endsAt = requireDate(c.endsAt, "endsAt");
    const capacity = requireInt(c.capacity, "capacity", 1);
 
    if (endsAt <= startsAt) fail("VALIDATION_ERROR", "endsAt debe ser posterior a startsAt");
 
    const resource = await readItem(`RESOURCE#${resourceId}`, "META");
    if (!resource) fail("NOT_FOUND", "ese recurso no existe");
 
    const slotId = crypto.randomUUID();
    const slot = {
        PK: `SLOT#${slotId}`, SK: "META",
        GSI1PK: `RESOURCE#${resourceId}`, GSI1SK: startsAt,
        slotId, resourceId, resourceName: resource.name, timezone: resource.timezone,
        startsAt, endsAt, capacity, reserved_count: 0, status: "OPEN",
    };
 
    await ddb.send(new PutItemCommand({
        TableName: TABLE, Item: toItem(slot),
        ConditionExpression: "attribute_not_exists(PK)",
    }));
    return json(201, slotView(slot));
}