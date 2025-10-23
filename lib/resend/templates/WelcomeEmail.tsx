import * as React from "react";

interface WelcomeEmailProps {
  username: string;
}

export const WelcomeEmail: React.FC<WelcomeEmailProps> = ({ username }) => (
  <div style={{ fontFamily: "sans-serif", padding: "20px" }}>
    <h1 style={{ color: "#333" }}>Welcome to Rybn!</h1>
    <p>Hi {username},</p>
    <p>
      Thanks for joining Rybn - where gift giving is beautifully wrapped and
      tied together.
    </p>
    <p>
      You can now create groups, build wishlists, coordinate gifts with others,
      and organize Secret Santa events with your family, friends, and
      colleagues.
    </p>
    <p>
      <a
        href={`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`}
        style={{
          backgroundColor: "#5034FF",
          color: "white",
          padding: "12px 24px",
          textDecoration: "none",
          borderRadius: "4px",
          display: "inline-block",
        }}
      >
        Get Started
      </a>
    </p>
    <p style={{ marginTop: "40px", color: "#666", fontSize: "14px" }}>
      Tied together,
      <br />
      The Rybn Team
    </p>
  </div>
);
