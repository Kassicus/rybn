import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Both marks render and CSS picks one, rather than reading the theme in JS.
 * A hook would need the hydration gate, which means either a flash of the
 * wrong mark or a hole in the top bar on first paint; `dark:` classes are
 * resolved by the same pre-paint script that sets the theme, so the right
 * one is correct in the first frame.
 *
 * The white mark already existed in public/brand and had never been wired up,
 * which is why the wordmark disappeared into the bar in dark mode.
 */
export function Logo({ width = 240, height = 96, className = "" }: LogoProps) {
  return (
    <>
      <Image
        src="/brand/rybn_logo_black.svg"
        alt="Rybn"
        width={width}
        height={height}
        priority
        className={cn("dark:hidden", className)}
      />
      <Image
        src="/brand/rybn_logo_white.svg"
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        priority
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
