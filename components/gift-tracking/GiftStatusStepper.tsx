"use client";

import {
  Lightbulb,
  ShoppingCart,
  Package,
  Gift,
  CheckCircle2,
  Check,
} from "lucide-react";
import { Text } from "@/components/ui/text";
import { giftStatuses, STATUS_INFO, type GiftStatus } from "@/lib/schemas/gift-tracking";

const statusIcons = {
  planned: Lightbulb,
  ordered: ShoppingCart,
  arrived: Package,
  wrapped: Gift,
  given: CheckCircle2,
};

interface GiftStatusStepperProps {
  currentStatus: GiftStatus;
  onStatusChange?: (status: GiftStatus) => void;
  compact?: boolean;
}

export function GiftStatusStepper({
  currentStatus,
  onStatusChange,
  compact = false,
}: GiftStatusStepperProps) {
  const currentStep = STATUS_INFO[currentStatus].step;
  const currentInfo = STATUS_INFO[currentStatus];

  return (
    <div className={`${compact ? "py-2" : "py-4"}`}>
      <div className="flex items-center justify-between">
        {giftStatuses.map((status, index) => {
          const info = STATUS_INFO[status];
          const Icon = statusIcons[status];
          const isCompleted = info.step < currentStep;
          const isCurrent = status === currentStatus;
          const isClickable = !!onStatusChange;

          // Determine colors based on state
          let bgColor: string;
          let textColor: string;

          if (isCurrent) {
            bgColor = info.hexBgColor;
            textColor = info.hexColor;
          } else if (isCompleted) {
            bgColor = info.hexColor; // Use the status color as background when completed
            textColor = '#FFFFFF';
          } else {
            bgColor = '#F3F4F6'; // gray-100
            textColor = '#9CA3AF'; // gray-400
          }

          return (
            <div key={status} className="flex items-center flex-1">
              {/* Step */}
              <div className="flex flex-col items-center flex-shrink-0">
                <button
                  onClick={() => onStatusChange?.(status)}
                  disabled={!isClickable}
                  className={`
                    relative flex items-center justify-center rounded-full transition-all
                    ${compact ? "w-8 h-8" : "w-12 h-12"}
                    ${isCurrent ? "ring-2 ring-offset-2 ring-primary" : ""}
                    ${isClickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}
                  `}
                  style={{ backgroundColor: bgColor, color: textColor }}
                >
                  {isCompleted ? (
                    <Check className={compact ? "w-4 h-4" : "w-5 h-5"} />
                  ) : (
                    <Icon className={compact ? "w-4 h-4" : "w-5 h-5"} />
                  )}
                </button>

                {!compact && (
                  <Text
                    size="sm"
                    className="mt-2 text-center font-medium"
                    style={{ color: isCurrent || isCompleted ? info.hexColor : '#676879' }}
                  >
                    {info.label}
                  </Text>
                )}
              </div>

              {/* Connector line */}
              {index < giftStatuses.length - 1 && (
                <div
                  className="flex-1 h-1 mx-2 rounded-full transition-colors"
                  style={{
                    backgroundColor: info.step < currentStep ? info.hexColor : '#E5E7EB'
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Current status description (only in non-compact mode) */}
      {!compact && (
        <div className="mt-4 text-center">
          <Text variant="secondary" size="sm">
            {currentInfo.description}
          </Text>
        </div>
      )}
    </div>
  );
}
