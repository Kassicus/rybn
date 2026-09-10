import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex justify-center">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#9F1239", // cranberry; mirrors --accent, which Clerk cannot read
            fontFamily: "var(--font-quicksand)",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
