import { useState } from "react";
import { VeloxApp } from "@/components/VeloxApp";
import { readOnboardingCompleted } from "@/features/onboarding/constants";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { registerBuiltInPlugins } from "@/features/plugins/bootstrap";

registerBuiltInPlugins();

function App() {
	const [onboardingDone, setOnboardingDone] = useState(() =>
		readOnboardingCompleted(),
	);

	return !onboardingDone ? (
		<OnboardingFlow onComplete={() => setOnboardingDone(true)} />
	) : (
		<VeloxApp />
	);
}

export default App;
