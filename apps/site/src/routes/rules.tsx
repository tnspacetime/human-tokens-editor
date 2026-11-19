import { createFileRoute, Link } from "@tanstack/react-router";
import { RuleList } from "../components/Rules";
import { HOW_IT_WORKS, RULES } from "../lib/rules";
import { share } from "../lib/share";

// The rules on a page of their own, to link to: from the publish pledge,
// the footer, or anywhere someone asks what this place is. Under them, how
// a piece lives here once it's published.
export const Route = createFileRoute("/rules")({
	head: () => share({ title: "The rules", description: RULES.map((r) => r.title).join(" "), path: "/rules" }),
	component: RulesPage,
});

function RulesPage() {
	return (
		<main className="rules-page">
			<p className="rules-eyebrow">Human Tokens</p>
			<h1>The rules</h1>
			<p className="rules-intro">Six, all about the writing. Then how a post lives here.</p>
			<RuleList large />
			<h2 className="rules-section">How it works</h2>
			<RuleList large plain items={HOW_IT_WORKS} />
			<p className="rules-back">
				<Link to="/">Read what people wrote</Link>
			</p>
		</main>
	);
}
