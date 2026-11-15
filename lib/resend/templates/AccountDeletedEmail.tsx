import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
} from "@react-email/components";

interface AccountDeletedEmailProps {
  supportEmail: string;
}

/**
 * Sent once a person's account is deleted: what went with it, and where to
 * write if they did not delete it themselves.
 */
export const AccountDeletedEmail: React.FC<AccountDeletedEmailProps> = ({
  supportEmail,
}) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={h1}>Your Rybn account has been deleted</Heading>

            <Text style={text}>
              Your Rybn account and everything in it have been removed: your
              profile, wishlist, pictures and gift tracker.
            </Text>

            <Text style={text}>
              If you didn&apos;t delete your account, write to us at {supportEmail}.
            </Text>

            <Hr style={hr} />

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

// The same styles as WelcomeEmail.tsx. Colours are hardcoded hex, not theme
// tokens, on purpose: mail clients do not support CSS custom properties, so
// app/globals.css cannot reach here. These mirror the light palette and have
// to be updated by hand if those move.
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
