class PaymentGateway {
  authorizePayment(invoice) {
    return invoice.totalCents > 0 && invoice.currency === "EUR";
  }
}

function calculateInvoice(lines) {
  return {
    currency: "EUR",
    totalCents: lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0),
  };
}

function reconcileLedger(entries) {
  return entries.filter((entry) => entry.status !== "settled");
}

module.exports = { PaymentGateway, calculateInvoice, reconcileLedger };
