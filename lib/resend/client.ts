import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is not set");
}

export const resend = new Resend(process.env.RESEND_API_KEY);

export const EMAIL_FROM = process.env.EMAIL_FROM_ADDRESS || "hello@rybn.app";
export const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "Rybn";
