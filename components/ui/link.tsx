import * as React from "react";
import NextLink from "next/link";
import { cn } from "@/lib/utils";

export interface LinkProps extends React.ComponentPropsWithoutRef<typeof NextLink> {
  className?: string;
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <NextLink
        ref={ref}
        className={cn(
          "text-primary hover:text-primary-hover font-medium transition-colors underline",
          className
        )}
        {...props}
      >
        {children}
      </NextLink>
    );
  }
);
Link.displayName = "Link";
