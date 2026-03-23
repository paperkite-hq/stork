import { getPasswordStrength } from "../password-strength";

interface PasswordStrengthMeterProps {
	password: string;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
	const strength = getPasswordStrength(password);
	if (password.length === 0) return null;

	return (
		<div className="mt-1.5 space-y-1">
			<div className="flex gap-1">
				{[1, 2, 3, 4].map((level) => (
					<div
						key={level}
						className={`h-1 flex-1 rounded-full transition-colors ${
							level <= strength.score ? strength.color : "bg-gray-200 dark:bg-gray-700"
						}`}
					/>
				))}
			</div>
			<p className={`text-xs ${strength.textColor}`} data-testid="password-strength">
				{strength.label}
			</p>
		</div>
	);
}
