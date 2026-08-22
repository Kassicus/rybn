import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignUp
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
