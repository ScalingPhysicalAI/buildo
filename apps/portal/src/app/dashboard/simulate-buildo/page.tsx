import { BuildoPolicyViewer } from "@/components/simulation/BuildoPolicyViewer";

// Phase 4 preview -- OpenArm/buildo_v0 driven live by services/policy-server
// over real HTTP, not by any script running in the browser. Separate route
// from /dashboard/simulate on purpose: that page is the existing, working
// simulator (a different robot entirely) and must not be touched by this
// still-experimental work. Not linked from the sidebar yet -- open directly
// at /dashboard/simulate-buildo. Requires services/policy-server running
// locally (see that package's README) at NEXT_PUBLIC_POLICY_SERVER_URL
// (defaults to http://localhost:8000/act).
export default function SimulateBuildoPage() {
  return (
    <div className="h-full min-h-[600px] w-full bg-[#f3efe4]">
      <BuildoPolicyViewer className="h-full w-full" />
    </div>
  );
}
