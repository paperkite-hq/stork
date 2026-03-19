import { Component, type ReactNode } from "react";
import { AlertCircleIcon } from "./Icons";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;

			return (
				<div className="flex-1 flex items-center justify-center p-8">
					<div className="text-center max-w-md">
						<AlertCircleIcon className="w-10 h-10 text-red-400 mx-auto mb-3" />
						<h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
							Something went wrong
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
							{this.state.error?.message || "An unexpected error occurred."}
						</p>
						<button
							type="button"
							onClick={() => this.setState({ hasError: false, error: null })}
							className="px-4 py-2 text-sm bg-stork-600 hover:bg-stork-700 text-white rounded-lg transition-colors"
						>
							Try Again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
