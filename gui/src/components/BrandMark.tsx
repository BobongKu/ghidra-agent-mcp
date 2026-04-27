import { cn } from "@/lib/utils";
import markUrl from "@/assets/brand-mark.png";

interface Props {
  size?: number;
  className?: string;
}

/**
 * Brand mark — pixel-art three-headed dragon (Ghidra) with Claude rider,
 * generated via pixelforge MCP. Crisp at small sizes thanks to image-rendering:pixelated.
 */
export function BrandMark({ size = 28, className }: Props) {
  return (
    <img
      src={markUrl}
      width={size}
      height={size}
      alt="Claude riding Ghidra"
      draggable={false}
      className={cn("shrink-0 select-none", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
