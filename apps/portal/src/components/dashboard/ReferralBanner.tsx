import Link from "next/link";
import { ArrowUpRight, Gift } from "lucide-react";

const REFERRAL_URL = "https://startforgerobotics.goaffpro.com/";

export function ReferralBanner() {
  return (
    <Link
      href={REFERRAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="glow-sand group flex flex-col gap-4 rounded-sm border border-border-strong bg-linear-to-r from-sand/15 via-panel to-panel p-6 transition-colors hover:border-sand sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-sand/15 text-sand">
          <Gift size={22} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-technical text-xs text-sand mb-1">REFERRAL PROGRAM</p>
          <p className="text-display text-xl text-off-white">
            Refer Buildo to a friend, Get $500 reward on every purchase
          </p>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm bg-sand px-5 py-2.5 text-sm font-medium text-black transition-colors group-hover:bg-sand-light">
        Get my link
        <ArrowUpRight
          size={16}
          className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
