import { resend, EMAIL_FROM, EMAIL_FROM_NAME } from "./client";
import { WelcomeEmail } from "./templates/WelcomeEmail";
import { GroupInviteEmail } from "./templates/GroupInviteEmail";
import { DateReminderEmail } from "./templates/DateReminderEmail";
import { TestEmail } from "./templates/TestEmail";
import { render } from "@react-email/render";

export async function sendWelcomeEmail(email: string, username: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';
  const supportEmail = process.env.EMAIL_SUPPORT || 'support@rybn.app';

  const emailHtml = await render(
    <WelcomeEmail username={username} appUrl={appUrl} />
  );

  const emailText = await render(
    <WelcomeEmail username={username} appUrl={appUrl} />,
    { plainText: true }
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: email,
    replyTo: supportEmail,
    subject: "Welcome to Rybn!",
    html: emailHtml,
    text: emailText,
    headers: {
      'X-Entity-Ref-ID': `welcome-${Date.now()}`,
    },
  });
}

export async function sendGroupInviteEmail(data: {
  toEmail: string;
  groupName: string;
  inviterName: string;
  inviteToken: string;
  /**
   * Switches the template between "here is what Rybn is, come create an
   * account" and "sign in to accept". Supplied by the caller rather than
   * looked up here: sendGroupInvitation already queries user_profiles for
   * this email to decide whether the invitee is in the group, so the answer
   * exists before this is called -- and keeping the query there leaves this
   * module free of any database of its own.
   */
  isNewUser: boolean;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';
  const supportEmail = process.env.EMAIL_SUPPORT || 'support@rybn.app';
  const inviteUrl = `${appUrl}/accept-invite?token=${data.inviteToken}`;
  const unsubscribeUrl = `${appUrl}/settings`;

  const emailHtml = await render(
    <GroupInviteEmail
      groupName={data.groupName}
      inviterName={data.inviterName}
      inviteUrl={inviteUrl}
      isNewUser={data.isNewUser}
    />
  );

  const emailText = await render(
    <GroupInviteEmail
      groupName={data.groupName}
      inviterName={data.inviterName}
      inviteUrl={inviteUrl}
      isNewUser={data.isNewUser}
    />,
    { plainText: true }
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    replyTo: supportEmail,
    subject: `You're invited to join ${data.groupName} on Rybn`,
    html: emailHtml,
    text: emailText,
    headers: {
      'X-Entity-Ref-ID': `invite-${data.inviteToken}`,
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';
  const supportEmail = process.env.EMAIL_SUPPORT || 'support@rybn.app';
  const profileUrl = `${appUrl}/profile/${data.celebrantUserId}`;
  const wishlistUrl = `${appUrl}/wishlist/${data.celebrantUserId}`;
  const unsubscribeUrl = `${appUrl}/settings`;

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

  const emailText = await render(
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
    />,
    { plainText: true }
  );

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: data.toEmail,
    replyTo: supportEmail,
    subject: `${emoji} ${data.celebrantName}'s ${dateTypeLabel} - ${data.celebrationDate}`,
    html: emailHtml,
    text: emailText,
    headers: {
      'X-Entity-Ref-ID': `reminder-${data.celebrantUserId}-${Date.now()}`,
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

export async function sendTestEmail(email: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';
  const supportEmail = process.env.EMAIL_SUPPORT || 'support@rybn.app';
  const unsubscribeUrl = `${appUrl}/settings`;

  const emailHtml = await render(<TestEmail appUrl={appUrl} />);
  const emailText = await render(<TestEmail appUrl={appUrl} />, { plainText: true });

  return await resend.emails.send({
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
    to: email,
    replyTo: supportEmail,
    subject: "Rybn Email Deliverability Test",
    html: emailHtml,
    text: emailText,
    headers: {
      'X-Entity-Ref-ID': `test-${Date.now()}`,
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
