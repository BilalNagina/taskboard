import nodemailer from 'nodemailer';

// SMTP works with Amazon SES, Mailgun, Postmark or a local Mailpit alike. Without a host,
// messages are logged instead of sent, which keeps development and tests offline.
export function createMailer({ host, port, user, pass, from }, logger) {
  const transport = host
    ? nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      })
    : nodemailer.createTransport({ jsonTransport: true });

  return {
    async send({ to, subject, text, html }) {
      const info = await transport.sendMail({ from, to, subject, text, html });
      // The body is logged so links (password resets) are still usable in development.
      if (!host) logger?.info({ to, subject, text }, 'email not sent (SMTP_HOST not set)');
      return info.messageId;
    },
    close: () => transport.close(),
  };
}
