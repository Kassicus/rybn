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
}) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={h1}>You&apos;re invited to join {groupName} on Rybn!</Heading>

            <Text style={text}>
              {inviterName} has invited you to join <strong>{groupName}</strong> on Rybn.
            </Text>

            <Text style={text}>
              {isNewUser
                ? "Rybn is a gift coordination app that helps groups coordinate wishlists, organize Secret Santa events, and make gift giving stress-free."
                : "Sign in to your Rybn account to accept this invitation."}
            </Text>

            <Section style={buttonContainer}>
              <Link
                href={inviteUrl}
                style={button}
              >
                {isNewUser ? "Join Rybn & Accept Invite" : "Accept Invitation"}
              </Link>
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              Tied together,
              <br />
              The Rybn Team
            </Text>

            <Text style={footerSmall}>
              If you didn&apos;t expect this invitation, you can safely ignore this email.
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

const buttonContainer = {
  padding: "27px 0 27px",
};

const button = {
  backgroundColor: "#9F1239",
  borderRadius: "4px",
  color: "#FFF7F0",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  width: "250px",
  padding: "12px 24px",
};

const hr = {
  borderColor: "#E4DED2",
  margin: "20px 0",
};

const footer = {
  color: "#746E62",
  fontSize: "14px",
  lineHeight: "24px",
  marginTop: "32px",
};

const footerSmall = {
  color: "#746E62",
  fontSize: "12px",
  lineHeight: "16px",
  marginTop: "16px",
};
