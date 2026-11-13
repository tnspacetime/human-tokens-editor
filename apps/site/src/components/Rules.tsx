import { Link } from "@tanstack/react-router";
import { RULES } from "../lib/rules";

// On the homepage, the rules are only a small glass pill that says so: it
// invites a click through to their own page rather than reading them here.
export function RulesPill() {
	return (
		<nav className="rules-pill-row" aria-label="The rules">
			<Link to="/rules" className="rules-pill">
				The rules
				<svg className="rules-pill-chevron" viewBox="0 0 8 14" aria-hidden="true">
					<path d="M1.5 1.5 6.5 7l-5 5.5" />
				</svg>
			</Link>
		</nav>
	);
}

export function RuleList({ large }: { large?: boolean }) {
	return (
		<ol className={large ? "rule-list large" : "rule-list"}>
			{RULES.map((rule, index) => (
				<li key={rule.title} style={{ ["--n" as string]: index }}>
					<span className="rule-number" aria-hidden="true">
						{index + 1}
					</span>
					<p className="rule-title">{rule.title}</p>
					<p className="rule-line">{rule.line}</p>
				</li>
			))}
		</ol>
	);
}
