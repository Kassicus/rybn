import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Heading,
  Hr,
} from "@react-email/components";

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
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={h1}>
              {emoji} {dateTypeLabel} Reminder
            </Heading>

            <Text style={text}>Hi {recipientName},</Text>

            <Text style={text}>
              This is a friendly reminder that <strong>{celebrantName}</strong> from your{" "}
              <strong>{groupName}</strong> group has a special day coming up:
            </Text>

            <Section style={highlightBox}>
              <Text style={highlightTitle}>
                {celebrantName}'s {dateTypeLabel}
              </Text>
              <Text style={highlightDate}>{celebrationDate}</Text>
              <Text style={highlightSubtext}>
                Group: {groupName} ({groupType})
              </Text>
            </Section>

            <Text style={text}>
              Want to make their day special? Check out their profile and wishlist to find the perfect gift!
            </Text>

            <Section style={buttonContainer}>
              <Link href={wishlistUrl} style={buttonPrimary}>
                View {celebrantName}'s Wishlist
              </Link>
              <Link href={profileUrl} style={buttonSecondary}>
                View Profile
              </Link>
            </Section>

            <Hr style={hr} />

            <Text style={footerText}>
              You're receiving this because you're a member of the <strong>{groupName}</strong> group and {celebrantName} has shared their {dateType} with the group.
            </Text>

            <Text style={footer}>
              Tied together,
              <br />
              The Rybn Team
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
  maxWidth: "600px",
};

const content = {
  padding: "0 48px",
};

const h1 = {
  color: "#333333",
  fontSize: "24px",
  fontWeight: "bold",
  margin: "40px 0 20px",
  padding: "0",
};

const text = {
  color: "#333333",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "16px 0",
};

const highlightBox = {
  backgroundColor: "#f5f5ff",
  border: "2px solid #5034FF",
  borderRadius: "8px",
  padding: "20px",
  margin: "20px 0",
};

const highlightTitle = {
  margin: "0 0 8px 0",
  fontSize: "18px",
  fontWeight: "bold",
  color: "#5034FF",
};

const highlightDate = {
  margin: "0",
  fontSize: "20px",
  fontWeight: "bold",
  color: "#333",
};

const highlightSubtext = {
  margin: "8px 0 0 0",
  fontSize: "14px",
  color: "#666",
};

const buttonContainer = {
  padding: "20px 0",
};

const buttonPrimary = {
  backgroundColor: "#5034FF",
  color: "#fff",
  padding: "12px 24px",
  textDecoration: "none",
  borderRadius: "4px",
  display: "inline-block",
  marginRight: "12px",
  marginBottom: "8px",
  fontSize: "16px",
  fontWeight: "bold",
};

const buttonSecondary = {
  backgroundColor: "#ffffff",
  color: "#5034FF",
  padding: "12px 24px",
  textDecoration: "none",
  borderRadius: "4px",
  display: "inline-block",
  border: "2px solid #5034FF",
  fontSize: "16px",
  fontWeight: "bold",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "30px 0 20px 0",
};

const footerText = {
  fontSize: "14px",
  color: "#666666",
  lineHeight: "24px",
  margin: "16px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "14px",
  lineHeight: "24px",
  marginTop: "32px",
};
