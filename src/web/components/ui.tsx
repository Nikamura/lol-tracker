import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { cn } from "../lib/cn.js";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline:
    "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 py-2",
  lg: "h-10 px-6",
  icon: "size-9",
};

type ButtonProps = Omit<JSX.IntrinsicElements["button"], "class" | "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
};

export const Button: FC<ButtonProps> = ({
  variant = "default",
  size = "md",
  class: cls,
  children,
  ...rest
}) => (
  <button
    class={cn(buttonBase, buttonVariants[variant], buttonSizes[size], cls)}
    {...rest}
  >
    {children}
  </button>
);

export const Card: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <div class={cn("bg-card text-card-foreground rounded-xl border shadow-sm", cls)}>
    {children}
  </div>
);

export const CardHeader: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <div class={cn("flex flex-col gap-1.5 px-6 py-4", cls)}>{children}</div>
);

export const CardTitle: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <h3 class={cn("text-lg font-semibold leading-none tracking-tight", cls)}>{children}</h3>
);

export const CardDescription: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <p class={cn("text-sm text-muted-foreground", cls)}>{children}</p>
);

export const CardContent: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <div class={cn("px-6 py-4", cls)}>{children}</div>
);

export const CardFooter: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <div class={cn("flex items-center px-6 py-4", cls)}>{children}</div>
);

type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "text-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  success:
    "border-success/30 bg-success/15 text-success [--success:oklch(0.696_0.17_162.48)]",
};

export const Badge: FC<PropsWithChildren<{ variant?: BadgeVariant; class?: string }>> = ({
  variant = "default",
  class: cls,
  children,
}) => (
  <span
    class={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
      badgeVariants[variant],
      cls,
    )}
  >
    {children}
  </span>
);

export const Table: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <div class="relative w-full overflow-auto">
    <table class={cn("w-full caption-bottom text-sm", cls)}>{children}</table>
  </div>
);

export const THead: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <thead class={cn("[&_tr]:border-b", cls)}>{children}</thead>
);

export const TBody: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <tbody class={cn("[&_tr:last-child]:border-0", cls)}>{children}</tbody>
);

export const TR: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <tr class={cn("border-b transition-colors hover:bg-muted/50", cls)}>{children}</tr>
);

export const TH: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <th
    class={cn(
      "h-10 px-3 text-left align-middle font-medium text-muted-foreground",
      cls,
    )}
  >
    {children}
  </th>
);

export const TD: FC<PropsWithChildren<{ class?: string }>> = ({ children, class: cls }) => (
  <td class={cn("px-3 py-3 align-middle", cls)}>{children}</td>
);

export const Empty: FC<PropsWithChildren<{ title: string; description?: string }>> = ({
  title,
  description,
  children,
}) => (
  <div class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
    <p class="font-medium">{title}</p>
    {description ? <p class="text-sm text-muted-foreground">{description}</p> : null}
    {children}
  </div>
);

type InputProps = Omit<JSX.IntrinsicElements["input"], "class" | "className"> & {
  class?: string;
};

export const Input: FC<InputProps> = ({ class: cls, ...rest }) => (
  <input
    class={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      cls,
    )}
    {...rest}
  />
);

type SelectProps = Omit<JSX.IntrinsicElements["select"], "class" | "className"> & {
  class?: string;
};

export const Select: FC<PropsWithChildren<SelectProps>> = ({ class: cls, children, ...rest }) => (
  <select
    class={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      cls,
    )}
    {...rest}
  >
    {children}
  </select>
);

export const Label: FC<PropsWithChildren<{ for?: string; class?: string }>> = ({
  for: htmlFor,
  class: cls,
  children,
}) => (
  <label for={htmlFor} class={cn("text-xs font-medium text-muted-foreground", cls)}>
    {children}
  </label>
);

export const Separator: FC<{ class?: string }> = ({ class: cls }) => (
  <div role="separator" class={cn("bg-border h-px w-full", cls)} />
);
