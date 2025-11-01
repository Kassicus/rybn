import { resend, EMAIL_FROM, EMAIL_FROM_NAME } from "./client";
import { WelcomeEmail } from "./templates/WelcomeEmail";
import { GroupInviteEmail } from "./templates/GroupInviteEmail";
import { DateReminderEmail } from "./templates/DateReminderEmail";
import { render } from "@react-email/render";

export async function sendWelcomeEmail(email: string, username: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';

  const emailHtml = await render(
    <WelcomeEmail username={username} appUrl={appUrl} />
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: email,
    subject: "Welcome to Rybn!",
    html: emailHtml,
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

  const emailHtml = await render(
    <GroupInviteEmail
      groupName={data.groupName}
      inviterName={data.inviterName}
      inviteUrl={inviteUrl}
      isNewUser={isNewUser}
    />
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    subject: `You're invited to join ${data.groupName} on Rybn`,
    html: emailHtml,
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

  const emailHtml = await render(
    <DateReminderEmail
      recipientName={data.recipientName}
      celebrantName={data.celebrantName}
      celebrantUsername={data.celebrantUsername}
      dateType={data.dateType}
      celebrationDate={data.celebrationDate}
      groupName={data.groupName}
      groupType={data.groupType}
      profileUrl={profileUrl}
      wishlistUrl={wishlistUrl}
    />
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    subject: `${emoji} ${data.celebrantName}'s ${dateTypeLabel} - ${data.celebrationDate}`,
    html: emailHtml,
  });
}
