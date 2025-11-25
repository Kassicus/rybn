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

  return (
    <div className={`${compact ? "py-2" : "py-4"}`}>
      <div className="flex items-center justify-between">
        {giftStatuses.map((status, index) => {
          const info = STATUS_INFO[status];
          const Icon = statusIcons[status];
          const isCompleted = info.step < currentStep;
          const isCurrent = status === currentStatus;
          const isClickable = !!onStatusChange;

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
                    ${
                      isCurrent
                        ? `${info.bgColor} ${info.color} ring-2 ring-offset-2 ring-primary`
                        : isCompleted
                        ? "bg-success text-white"
                        : "bg-gray-100 text-gray-400"
                    }
                    ${isClickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}
                  `}
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
                    className={`mt-2 text-center ${
                      isCurrent || isCompleted
                        ? "font-medium text-light-text-primary"
                        : "text-light-text-secondary"
                    }`}
                  >
                    {info.label}
                  </Text>
                )}
              </div>

              {/* Connector line */}
              {index < giftStatuses.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-2 rounded-full transition-colors ${
                    info.step < currentStep ? "bg-success" : "bg-gray-200"
                  }`}
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
            {STATUS_INFO[currentStatus].description}
          </Text>
        </div>
      )}
    </div>
  );
}
