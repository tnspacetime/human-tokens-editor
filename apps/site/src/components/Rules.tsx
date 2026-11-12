import { Link } from "@tanstack/react-router";
import { RULES } from "../lib/rules";

// The five rules, as a calm band on the homepage: a number, the rule, and
// one plain line under it.
export function RulesBand() {
	return (
		<section className="rules" aria-labelledby="rules-title">
			<header className="section-head">
				<h2 id="rules-title">The rules</h2>
				<Link to="/rules" className="section-link">
					On their own page
				</Link>
			</header>
			<RuleList />
		</section>
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
