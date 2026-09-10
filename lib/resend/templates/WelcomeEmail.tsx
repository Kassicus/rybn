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

interface WelcomeEmailProps {
  username: string;
  appUrl: string;
}

export const WelcomeEmail: React.FC<WelcomeEmailProps> = ({
  username,
  appUrl
}) => {
  const dashboardUrl = `${appUrl}/dashboard`;

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={h1}>Welcome to Rybn!</Heading>

            <Text style={text}>Hi {username},</Text>

            <Text style={text}>
              Thanks for joining Rybn - where gift giving is beautifully wrapped and
              tied together.
            </Text>

            <Text style={text}>
              You can now create groups, build wishlists, coordinate gifts with others,
              and organize Secret Santa events with your family, friends, and
              colleagues.
            </Text>

            <Section style={buttonContainer}>
              <Link
                href={dashboardUrl}
                style={button}
              >
                Get Started
              </Link>
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              Tied together,
              <br />
              The Rybn Team
            </Text>

            <Text style={footerSmall}>
              If you didn&apos;t create an account with Rybn, you can safely ignore this email.
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
  width: "200px",
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
