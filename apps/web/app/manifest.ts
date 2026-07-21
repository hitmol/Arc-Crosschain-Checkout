import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: brand.shortDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7fc",
    theme_color: "#4744d7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
