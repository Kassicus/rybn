import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(
            "flex h-12 w-full rounded border px-4 py-2 text-base transition-colors",
            // Light mode colors
            "bg-light-background text-light-text-primary placeholder:text-light-text-secondary",
            // Dark mode colors
            "dark:bg-dark-background-secondary dark:text-dark-text-primary dark:placeholder:text-dark-text-secondary",
            // Border colors
            error
              ? "border-error focus:ring-error"
              : "border-light-border dark:border-dark-border",
            // Focus states
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
            // Disabled state
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-error">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
