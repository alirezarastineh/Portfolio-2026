import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_FROM = process.env.CONTACT_FROM ?? "no-reply@alirezarastineh.me";
const CONTACT_TO = process.env.CONTACT_TO ?? "alirezakhalireza@gmail.com";

let client: Resend | null = null;

function getClient(): Resend {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!client) {
    client = new Resend(RESEND_API_KEY);
  }
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
  return Boolean(RESEND_API_KEY);
}

export async function sendContactEmail(payload: ContactPayload): Promise<SendResult> {
  try {
    const resend = getClient();
    const { error } = await resend.emails.send({
      from: `Portfolio Contact <${CONTACT_FROM}>`,
      to: [CONTACT_TO],
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
