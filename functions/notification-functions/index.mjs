// Lambda suscriptora al topic SNS
// Handler: index.handler
// Runtime: Node.js 24
//
// Esta funcion NO se invoca por HTTP. La invoca SNS cada vez que se
// publica un mensaje en el topic al que esta suscrita.
//
// SNS puede entregar varios mensajes en un mismo evento, por eso
// event.Records es un array.
//
// SIMULA el envio del correo: escribe en el log lo que SES habria enviado.

export const handler = async (event) => {
  console.log('Mensajes recibidos:', event.Records.length);

  for (const record of event.Records) {
    const { Message, MessageId, Subject, Timestamp, TopicArn } = record.Sns;

    // Message llega SIEMPRE como texto. Como el publicador envio un JSON,
    // aqui hay que deserializarlo. Si otro publicador enviara texto plano,
    // el catch evita que la funcion falle.
    let payload;
    try {
      payload = JSON.parse(Message);
    } catch {
      console.warn('El mensaje no era JSON, se procesa como texto plano:', Message);
      payload = { raw: Message };
    }

    console.log('Notificacion SNS recibida:', {
      messageId: MessageId,
      subject: Subject,
      timestamp: Timestamp,
      topic: TopicArn,
    });

    switch (payload.event) {
      case 'USER_REGISTERED':
      case 'RESERVATION_CONFIRMED':
      case 'RESERVATION_CANCELLED':
        // Aqui iria el SendEmailCommand de SES.
        console.log([
          '───────── CORREO SIMULADO ─────────',
          `Para:    ${payload.email}`,
          `Asunto:  ${payload.subject ?? Subject}`,
          '',
          payload.body,
          '───────────────────────────────────',
        ].join('\n'));
        console.log(`Evento procesado con exito: ${payload.event} para ${payload.email}`);
        break;

      default:
        console.warn('Tipo de evento desconocido, se ignora:', payload.event);
    }
  }

  // El valor devuelto no lo consume nadie: SNS invoca de forma asincrona.
  // Si la funcion lanza una excepcion, SNS reintenta la entrega.
  return { processed: event.Records.length };
};
