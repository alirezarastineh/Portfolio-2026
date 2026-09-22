import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  client ??= new Resend(apiKey);
  return client;
}

export interface ContactPayload {
  name: string;
  email: string;
  message: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendContactEmail(payload: ContactPayload): Promise<SendResult> {
  const contactFrom = process.env.CONTACT_FROM ?? "contact@alirezarastineh.me";
  const contactTo = process.env.CONTACT_TO ?? "contact@alirezarastineh.me";

  try {
    const resend = getClient();
    const { error } = await resend.emails.send({
      from: `Portfolio Contact <${contactFrom}>`,
      to: [contactTo],
      replyTo: payload.email,
      subject: `New contact from ${payload.name}`,
      text: [
        `Name:    ${payload.name}`,
        `Email:   ${payload.email}`,
        "",
        "Message:",
        payload.message,
      ].join("\n"),
    });
    if (error) {
      return { ok: false, error: error.message ?? "send_failed" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send_failed";
    return { ok: false, error: msg };
  }
}
