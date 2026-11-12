import { useState } from "react";
import { VeloxApp } from "@/components/VeloxApp";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { readOnboardingCompleted } from "@/features/onboarding/constants";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { bootstrapProFeatures } from "@/features/pro/bootstrapProFeatures";

bootstrapProFeatures();

function App() {
	const [onboardingDone, setOnboardingDone] = useState(() =>
		readOnboardingCompleted(),
	);

	return (
		<AuthProvider>
			{!onboardingDone ? (
				<OnboardingFlow onComplete={() => setOnboardingDone(true)} />
			) : (
				<VeloxApp />
			)}
		</AuthProvider>
	);
}

export default App;
