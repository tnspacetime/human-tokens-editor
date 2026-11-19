import { createFileRoute, Link } from "@tanstack/react-router";
import { RuleList } from "../components/Rules";
import { RULES } from "../lib/rules";

// The rules on a page of their own, to link to: from the publish pledge,
// the footer, or anywhere someone asks what this place is.
export const Route = createFileRoute("/rules")({
	head: () => ({
		meta: [
			{ title: "The rules · Human Tokens" },
			{ name: "description", content: RULES.map((r) => r.title).join(" ") },
		],
	}),
	component: RulesPage,
});

function RulesPage() {
	return (
		<main className="rules-page">
			<p className="rules-eyebrow">Human Tokens</p>
			<h1>The rules</h1>
			<p className="rules-intro">Six, all about the writing.</p>
			<RuleList large />
			<p className="rules-back">
				<Link to="/">Read what people wrote</Link>
			</p>
		</main>
	);
}
