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

// "Buy now & pay later" is a one-time scheme -- used to hide the Home
// screen's gadgets banner once the user already has an order on file.
export async function fetchGadgetOrderStatus(): Promise<{ hasOrder: boolean; order: GadgetOrder | null }> {
  return request<{ hasOrder: boolean; order: GadgetOrder | null }>("/api/gadgets/order");
}
