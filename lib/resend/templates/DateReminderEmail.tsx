import * as React from "react";

interface DateReminderEmailProps {
  recipientName: string;
  celebrantName: string;
  celebrantUsername: string;
  dateType: "birthday" | "anniversary";
  celebrationDate: string; // Formatted date string like "October 29th"
  groupName: string;
  groupType: "family" | "friends" | "work" | "custom";
  profileUrl: string;
  wishlistUrl: string;
}

export const DateReminderEmail: React.FC<DateReminderEmailProps> = ({
  recipientName,
  celebrantName,
  celebrantUsername,
  dateType,
  celebrationDate,
  groupName,
  groupType,
  profileUrl,
  wishlistUrl,
}) => {
  const dateTypeLabel = dateType === "birthday" ? "Birthday" : "Anniversary";
  const emoji = dateType === "birthday" ? "🎂" : "💝";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "20px", maxWidth: "600px" }}>
      <h1 style={{ color: "#333", fontSize: "24px", marginBottom: "16px" }}>
        {emoji} {dateTypeLabel} Reminder
      </h1>

      <p style={{ fontSize: "16px", lineHeight: "1.6", marginBottom: "12px" }}>
        Hi {recipientName},
      </p>

      <p style={{ fontSize: "16px", lineHeight: "1.6", marginBottom: "12px" }}>
        This is a friendly reminder that{" "}
        <strong>{celebrantName}</strong> from your{" "}
        <strong>{groupName}</strong> group has a special day coming up:
      </p>

      <div
        style={{
          backgroundColor: "#f5f5ff",
          border: "2px solid #5034FF",
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "20px",
        }}
      >
        <p style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "bold", color: "#5034FF" }}>
          {celebrantName}&apos;s {dateTypeLabel}
        </p>
        <p style={{ margin: "0", fontSize: "20px", fontWeight: "bold", color: "#333" }}>
          {celebrationDate}
        </p>
        <p style={{ margin: "8px 0 0 0", fontSize: "14px", color: "#666" }}>
          Group: {groupName} ({groupType})
        </p>
      </div>

      <p style={{ fontSize: "16px", lineHeight: "1.6", marginBottom: "20px" }}>
        Want to make their day special? Check out their profile and wishlist to find the perfect gift!
      </p>

      <div style={{ marginBottom: "20px" }}>
        <a
          href={wishlistUrl}
          style={{
            backgroundColor: "#5034FF",
            color: "white",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "4px",
            display: "inline-block",
            marginRight: "12px",
            marginBottom: "8px",
          }}
        >
          View {celebrantName}&apos;s Wishlist
        </a>
        <a
          href={profileUrl}
          style={{
            backgroundColor: "white",
            color: "#5034FF",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "4px",
            display: "inline-block",
            border: "2px solid #5034FF",
          }}
        >
          View Profile
        </a>
      </div>

      <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.6", marginTop: "30px" }}>
        You&apos;re receiving this because you&apos;re a member of the{" "}
        <strong>{groupName}</strong> group and {celebrantName} has shared their {dateType} with the group.
      </p>

      <p style={{ marginTop: "40px", color: "#666", fontSize: "14px" }}>
        Tied together,
        <br />
        The Rybn Team
      </p>
    </div>
  );
};
