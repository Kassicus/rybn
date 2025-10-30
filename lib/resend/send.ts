import { resend, EMAIL_FROM, EMAIL_FROM_NAME } from "./client";
import { WelcomeEmail } from "./templates/WelcomeEmail";
import { GroupInviteEmail } from "./templates/GroupInviteEmail";
import { DateReminderEmail } from "./templates/DateReminderEmail";
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

export async function sendDateReminderEmail(data: {
  toEmail: string;
  recipientName: string;
  celebrantName: string;
  celebrantUsername: string;
  celebrantUserId: string;
  dateType: "birthday" | "anniversary";
  celebrationDate: string; // Formatted date string like "October 29th"
  groupName: string;
  groupType: "family" | "friends" | "work" | "custom";
}) {
  const profileUrl = `${process.env.NEXT_PUBLIC_APP_URL}/profile/${data.celebrantUserId}`;
  const wishlistUrl = `${process.env.NEXT_PUBLIC_APP_URL}/wishlist/${data.celebrantUserId}`;

  const dateTypeLabel = data.dateType === "birthday" ? "Birthday" : "Anniversary";
  const emoji = data.dateType === "birthday" ? "🎂" : "💝";

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    subject: `${emoji} ${data.celebrantName}'s ${dateTypeLabel} - ${data.celebrationDate}`,
    react: createElement(DateReminderEmail, {
      recipientName: data.recipientName,
      celebrantName: data.celebrantName,
      celebrantUsername: data.celebrantUsername,
      dateType: data.dateType,
      celebrationDate: data.celebrationDate,
      groupName: data.groupName,
      groupType: data.groupType,
      profileUrl,
      wishlistUrl,
    }),
  });
}
