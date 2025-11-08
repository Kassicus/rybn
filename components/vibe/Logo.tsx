"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 200, height = 80, className = "" }: LogoProps) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine which logo to show
  const currentTheme = mounted ? (resolvedTheme || theme) : "light";
  const logoSrc = currentTheme === "dark" ? "/brand/rybn_logo_white.svg" : "/brand/rybn_logo_black.svg";

  // Show a placeholder during SSR to avoid hydration mismatch
  if (!mounted) {
    return <div style={{ width, height }} className={className} />;
  }

  return (
    <Image
      src={logoSrc}
      alt="Rybn"
      width={width}
      height={height}
      priority
      className={className}
    />
  );
}
