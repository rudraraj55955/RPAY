import jwt from "jsonwebtoken";

const SHARE_SECRET =
  process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

export interface SlipSharePayload {
  type: "payout_slip_share";
  payoutId: number;
  iat?: number;
  exp?: number;
}

export function signSlipShareToken(payoutId: number): string {
  const payload: { type: string; payoutId: number } = {
    type: "payout_slip_share",
    payoutId,
  };
  return jwt.sign(payload, SHARE_SECRET, { expiresIn: "24h" });
}

export function verifySlipShareToken(token: string): SlipSharePayload {
  const payload = jwt.verify(token, SHARE_SECRET) as SlipSharePayload;
  if (payload.type !== "payout_slip_share") throw new Error("Invalid token type");
  return payload;
}
