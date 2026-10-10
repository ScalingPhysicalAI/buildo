// "Use wallet" order flow for the Buildo Development Kit -- talks to
// /api/gadgets/order on the portal, same bearer-token request() helper as
// api.ts.

import { request } from "./api";
import type { SafeUser } from "./api";

export interface GadgetOrder {
  id: string;
  recipientName: string;
  recipientEmail: string;
  phone: string | null;
  shippingAddress: string;
  price: number;
  createdAt: string;
}

export async function placeGadgetOrder(input: {
  recipientName: string;
  recipientEmail: string;
  phone?: string;
  shippingAddress: string;
}): Promise<{ user: SafeUser; order: GadgetOrder }> {
  return request<{ user: SafeUser; order: GadgetOrder }>("/api/gadgets/order", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
