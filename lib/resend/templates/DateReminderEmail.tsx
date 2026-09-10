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
                {celebrantName}&apos;s {dateTypeLabel}
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
                View {celebrantName}&apos;s Wishlist
              </Link>
              <Link href={profileUrl} style={buttonSecondary}>
                View Profile
              </Link>
            </Section>

            <Hr style={hr} />

            <Text style={footerText}>
              You&apos;re receiving this because you&apos;re a member of the <strong>{groupName}</strong> group and {celebrantName} has shared their {dateType} with the group.
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

// Colours are hardcoded hex, not theme tokens, on purpose: mail clients do
// not support CSS custom properties, so app/globals.css cannot reach here.
// These mirror the light palette -- cream page, warm neutrals, evergreen for
// brand accents, cranberry for the action -- and have to be updated by hand
// if those move.
const main = {
  backgroundColor: "#FAF6EF",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#FFFDF9",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
  maxWidth: "600px",
};

const content = {
  padding: "0 48px",
};

const h1 = {
  color: "#1F2A24",
  fontSize: "24px",
  fontWeight: "bold",
  margin: "40px 0 20px",
  padding: "0",
};

const text = {
  color: "#1F2A24",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "16px 0",
};

const highlightBox = {
  backgroundColor: "#EAF0EA",
  border: "2px solid #14432A",
  borderRadius: "8px",
  padding: "20px",
  margin: "20px 0",
};

const highlightTitle = {
  margin: "0 0 8px 0",
  fontSize: "18px",
  fontWeight: "bold",
  color: "#14432A",
};

const highlightDate = {
  margin: "0",
  fontSize: "20px",
  fontWeight: "bold",
  color: "#1F2A24",
};

const highlightSubtext = {
  margin: "8px 0 0 0",
  fontSize: "14px",
  color: "#5C6660",
};

const buttonContainer = {
  padding: "20px 0",
};

const buttonPrimary = {
  backgroundColor: "#9F1239",
  color: "#FFF7F0",
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
  backgroundColor: "#FFFDF9",
  color: "#1F2A24",
  padding: "12px 24px",
  textDecoration: "none",
  borderRadius: "4px",
  display: "inline-block",
  border: "1px solid #9A8E80",
  fontSize: "16px",
  fontWeight: "bold",
};

const hr = {
  borderColor: "#E4DED2",
  margin: "30px 0 20px 0",
};

const footerText = {
  fontSize: "14px",
  color: "#5C6660",
  lineHeight: "24px",
  margin: "16px 0",
};

const footer = {
  color: "#746E62",
  fontSize: "14px",
  lineHeight: "24px",
  marginTop: "32px",
};
