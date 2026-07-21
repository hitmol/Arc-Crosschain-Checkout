import { ImageResponse } from "next/og";
import { brand } from "@/lib/brand";

export const alt = `${brand.productName} crosschain USDC checkout`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "72px 76px",
        background: "#f7f7fc",
        color: "#17182a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 670 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#4744d7",
              color: "white",
              fontSize: 27,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <span style={{ fontSize: 32, fontWeight: 800 }}>
            {brand.productName}
          </span>
        </div>
        <h1
          style={{
            fontSize: 68,
            lineHeight: 1.03,
            letterSpacing: -3.5,
            margin: "58px 0 28px",
          }}
        >
          Accept USDC across chains. Settle in one place.
        </h1>
        <div
          style={{ display: "flex", gap: 12, fontSize: 20, color: "#646579" }}
        >
          <span>{brand.infrastructureAttribution}</span>
          <span>·</span>
          <span>{brand.protocolAttribution}</span>
        </div>
      </div>
      <div
        style={{
          width: 330,
          height: 410,
          borderRadius: 28,
          padding: 30,
          display: "flex",
          flexDirection: "column",
          background: "white",
          border: "2px solid #dcddeb",
          boxShadow: "0 30px 70px #3632bd20",
        }}
      >
        <span style={{ color: "#646579", fontSize: 16 }}>AMOUNT DUE</span>
        <span style={{ fontSize: 49, fontWeight: 800, marginTop: 12 }}>
          125.00
        </span>
        <span style={{ color: "#646579", fontSize: 20 }}>USDC</span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 52,
            padding: "22px 0",
            borderTop: "2px solid #dcddeb",
            borderBottom: "2px solid #dcddeb",
            fontSize: 18,
          }}
        >
          <span>Base</span>
          <span style={{ color: "#4744d7" }}>→</span>
          <span>Arc</span>
        </div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "center",
            padding: "17px 20px",
            borderRadius: 12,
            background: "#4744d7",
            color: "white",
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          Review and pay
        </div>
      </div>
    </div>,
    size,
  );
}
