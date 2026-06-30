import { useState } from "react";
import { VeloxApp } from "@/components/VeloxApp";
import { readOnboardingCompleted } from "@/features/onboarding/constants";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";

function App() {
	const [onboardingDone, setOnboardingDone] = useState(() =>
		readOnboardingCompleted(),
	);

	if (!onboardingDone) {
		return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
	}

	return <VeloxApp />;
}

export default App;
