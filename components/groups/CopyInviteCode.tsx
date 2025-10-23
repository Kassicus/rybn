"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyInviteCodeProps {
  inviteCode: string;
}

export function CopyInviteCode({ inviteCode }: CopyInviteCodeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Button
      variant="tertiary"
      size="small"
      onClick={handleCopy}
      className="h-8 px-2"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-success" />
          <span className="text-xs">Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span className="text-xs">Copy</span>
        </>
      )}
    </Button>
  );
}
