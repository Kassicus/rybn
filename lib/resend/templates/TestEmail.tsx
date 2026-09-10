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

interface TestEmailProps {
  appUrl: string;
}

export const TestEmail: React.FC<TestEmailProps> = ({ appUrl }) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={h1}>Email Deliverability Test</Heading>

            <Text style={text}>
              This is a test email from Rybn to verify email deliverability and spam score.
            </Text>

            <Text style={text}>
              This email tests the following deliverability features:
            </Text>

            <Text style={listText}>
              ✅ HTML and plain text versions
              <br />
              ✅ SPF authentication
              <br />
              ✅ DKIM signatures
              <br />
              ✅ DMARC policy
              <br />
              ✅ Reply-To header
              <br />
              ✅ List-Unsubscribe headers
              <br />
              ✅ Proper from address
            </Text>

            <Section style={buttonContainer}>
              <Link href={appUrl} style={button}>
                Visit Rybn
              </Link>
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              Tied together,
              <br />
              The Rybn Team
              <br />
              Rybn
            </Text>

            <Text style={footerSmall}>
              This is an automated test email. If you received this in error, you can safely ignore it.
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

const listText = {
  color: "#1F2A24",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "16px 0",
  paddingLeft: "20px",
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
