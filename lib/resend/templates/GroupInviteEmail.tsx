import * as React from "react";

interface GroupInviteEmailProps {
  groupName: string;
  inviterName: string;
  inviteUrl: string;
  isNewUser: boolean;
}

export const GroupInviteEmail: React.FC<GroupInviteEmailProps> = ({
  groupName,
  inviterName,
  inviteUrl,
  isNewUser,
}) => (
  <div style={{ fontFamily: "sans-serif", padding: "20px" }}>
    <h1 style={{ color: "#333" }}>
      You&apos;re invited to join {groupName} on Rybn!
    </h1>
    <p>
      {inviterName} has invited you to join <strong>{groupName}</strong> on
      Rybn.
    </p>
    <p>
      {isNewUser
        ? "Rybn is a gift coordination app that helps groups coordinate wishlists, organize Secret Santa events, and make gift giving stress-free."
        : "Sign in to your Rybn account to accept this invitation."}
    </p>
    <p>
      <a
        href={inviteUrl}
        style={{
          backgroundColor: "#5034FF",
          color: "white",
          padding: "12px 24px",
          textDecoration: "none",
          borderRadius: "4px",
          display: "inline-block",
        }}
      >
        {isNewUser ? "Join Rybn & Accept Invite" : "Accept Invitation"}
      </a>
    </p>
    <p style={{ marginTop: "40px", color: "#666", fontSize: "14px" }}>
      Tied together,
      <br />
      The Rybn Team
    </p>
  </div>
);
