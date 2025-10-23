import { resend, EMAIL_FROM, EMAIL_FROM_NAME } from "./client";
import { WelcomeEmail } from "./templates/WelcomeEmail";
import { GroupInviteEmail } from "./templates/GroupInviteEmail";
import { createElement } from "react";

export async function sendWelcomeEmail(email: string, username: string) {
  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: email,
    subject: "Welcome to Rybn!",
    react: createElement(WelcomeEmail, { username }),
  });
}

export async function sendGroupInviteEmail(data: {
  toEmail: string;
  groupName: string;
  inviterName: string;
  inviteToken: string;
}) {
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${data.inviteToken}`;

  // For now, assume all invites are for new users
  // In the future, we can check if the email exists in the database
  const isNewUser = true;

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    subject: `You're invited to join ${data.groupName} on Rybn`,
    react: createElement(GroupInviteEmail, {
      groupName: data.groupName,
      inviterName: data.inviterName,
      inviteUrl,
      isNewUser,
    }),
  });
}
