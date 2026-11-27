// Adapted from shadcn/ui. See docs/SHADCN_LICENSE.md.
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90",
        outline: "border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--page)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Button({
  className,
  variant,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
