import Image from "next/image";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 200, height = 80, className = "" }: LogoProps) {
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
