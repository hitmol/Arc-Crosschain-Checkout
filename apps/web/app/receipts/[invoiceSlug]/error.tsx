"use client";

export default function ReceiptError({ reset }: { reset: () => void }) {
  return (
    <div className="page-shell receipt">
      <div className="card empty-state">
        <div className="section-kicker">RECEIPT UNAVAILABLE</div>
        <h1 className="page-title">Verified data could not be loaded.</h1>
        <p className="page-subtitle">
          The receipt API may be temporarily unavailable. No values have been
          substituted.
        </p>
        <button className="button secondary" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </div>
  );
}
