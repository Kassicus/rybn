"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Gift, ListPlus, Users, X } from "lucide-react";
import { Text } from "@/components/ui/text";

export function FloatingActionButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const actions = [
    {
      icon: Gift,
      label: "Create Group Gift",
      onClick: () => {
        router.push("/gifts/create");
        setIsOpen(false);
      },
      color: "bg-primary hover:bg-primary-hover",
    },
    {
      icon: ListPlus,
      label: "Add to Wishlist",
      onClick: () => {
        router.push("/wishlist");
        setIsOpen(false);
      },
      color: "bg-success hover:bg-success-hover",
    },
    {
      icon: Users,
      label: "Create Group",
      onClick: () => {
        router.push("/groups/create");
        setIsOpen(false);
      },
      color: "bg-warning hover:bg-warning-hover",
    },
  ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Action Menu */}
      <div className="fixed bottom-20 right-6 z-50 flex flex-col-reverse items-end gap-3">
        {isOpen &&
          actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className={`flex items-center gap-3 ${action.color} text-white rounded-full shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl group`}
                style={{
                  animation: `slideIn 0.2s ease-out ${index * 0.05}s both`,
                }}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <Icon className="w-5 h-5" />
                  <span className="font-medium whitespace-nowrap pr-1">
                    {action.label}
                  </span>
                </div>
              </button>
            );
          })}
      </div>

      {/* Main FAB */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300 ${
          isOpen
            ? "bg-error hover:bg-error-hover rotate-45 scale-110"
            : "bg-primary hover:bg-primary-hover hover:scale-110"
        }`}
        aria-label={isOpen ? "Close menu" : "Open create menu"}
      >
        <Plus className={`w-6 h-6 text-white transition-transform ${isOpen ? "rotate-0" : ""}`} />
      </button>

      {/* Animations */}
      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
