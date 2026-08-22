import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#009E01",
            fontFamily: "var(--font-quicksand)",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
