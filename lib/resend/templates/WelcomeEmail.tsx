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
              If you didn't create an account with Rybn, you can safely ignore this email.
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

const buttonContainer = {
  padding: "27px 0 27px",
};

const button = {
  backgroundColor: "#5034FF",
  borderRadius: "4px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  width: "200px",
  padding: "12px 24px",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "14px",
  lineHeight: "24px",
  marginTop: "32px",
};

const footerSmall = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
  marginTop: "16px",
};
