import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function CheckoutButton({
  children,
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button {...props}>{children}</button>;
}
