import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="flex justify-center">
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
