const crypto = require("crypto");

function maskLast4(cardNumber) {
  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (digits.length < 4) {
    return "0000";
  }
  return digits.slice(-4);
}

async function processPayment({ cardNumber, amount }) {
  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (digits.length < 12) {
    throw new Error("Invalid card details.");
  }
  if (Number(amount) <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  // Simulate secure gateway tokenization/authorization.
  const transactionId = `pay_${crypto.randomUUID()}`;
  return {
    reference: transactionId,
    status: "PAID",
    last4: maskLast4(cardNumber)
  };
}

module.exports = {
  processPayment
};
