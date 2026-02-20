import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  /** "page" = full-screen centered, "section" = container-relative centered, "inline" = small inline */
  variant?: "page" | "section" | "inline";
  /** Optional text to show below spinner */
  text?: string;
  /** Spinner size class (default varies by variant) */
  size?: string;
}

const LoadingState = ({ variant = "section", text, size }: LoadingStateProps) => {
  const sizeClass = size || (variant === "inline" ? "h-4 w-4" : "h-8 w-8");

  if (variant === "page") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className={`${sizeClass} animate-spin mx-auto mb-2 text-primary`} />
          {text && <p className="text-muted-foreground">{text}</p>}
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className={`${sizeClass} animate-spin text-muted-foreground`} />
        {text && <span className="text-xs text-muted-foreground">{text}</span>}
      </div>
    );
  }

  // section (default)
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <Loader2 className={`${sizeClass} animate-spin mx-auto mb-2 text-primary`} />
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
    </div>
  );
};

export default LoadingState;
