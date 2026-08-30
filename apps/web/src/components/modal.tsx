import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Modal({
  children,
  onClose,
  className,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card
        className={cn(
          "relative w-full max-w-2xl max-h-[min(90vh,920px)] overflow-y-auto p-6 space-y-4 glass shop-ring",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </Card>
    </div>,
    document.body,
  );
}
