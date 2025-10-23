import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const headingVariants = cva("font-semibold text-light-text-primary dark:text-dark-text-primary", {
  variants: {
    level: {
      h1: "text-4xl",
      h2: "text-3xl",
      h3: "text-2xl",
      h4: "text-xl",
    },
  },
  defaultVariants: {
    level: "h1",
  },
});

const textVariants = cva("", {
  variants: {
    variant: {
      primary: "text-light-text-primary dark:text-dark-text-primary",
      secondary: "text-light-text-secondary dark:text-dark-text-secondary",
      error: "text-error",
      success: "text-success",
    },
    size: {
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "base",
  },
});

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  as?: "h1" | "h2" | "h3" | "h4";
}

export interface TextProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level = "h1", as, children, ...props }, ref) => {
    const Comp = (as || level) as "h1" | "h2" | "h3" | "h4";
    return (
      <Comp
        ref={ref}
        className={cn(headingVariants({ level, className }))}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
Heading.displayName = "Heading";

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(textVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </p>
    );
  }
);
Text.displayName = "Text";
