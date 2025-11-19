import Image from "next/image";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 240, height = 96, className = "" }: LogoProps) {
  return (
    <Image
      src="/brand/rybn_logo_black.svg"
      alt="Rybn"
      width={width}
      height={height}
      priority
      className={className}
    />
  );
}
