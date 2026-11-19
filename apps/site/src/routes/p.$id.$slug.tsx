import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BrandMark } from "../components/BrandMark";
import { DeletePiece } from "../components/DeletePiece";
import { SeriesIsland } from "../components/island/SeriesIsland";
import { Byline } from "../components/PostCard";
import { Postscripts } from "../components/Postscripts";
import { Replies } from "../components/Replies";
import { share } from "../lib/share";
import { getPost } from "../server/site.functions";

// /p/<id>/<slug>: the id is permanent, the slug follows the title. An old
// or wrong slug redirects to the current one, so links never break.
export const Route = createFileRoute("/p/$id/$slug")({
	loader: async ({ params }) => {
		const post = await getPost({ data: { id: params.id } });
		if (post.slug !== params.slug) {
			throw redirect({ to: "/p/$id/$slug", params: { id: post.id, slug: post.slug }, statusCode: 301 });
		}
		return post;
	},
	head: ({ loaderData: post }) =>
		post
			? share({
					title: post.title,
					description: post.excerpt ?? `A post by ${post.author.name}, written by a person.`,
					path: `/p/${post.id}/${post.slug}`,
					type: "article",
					article: { publishedAt: post.publishedAt, authorPath: `/@${post.author.handle}` },
				})
			: {},
	component: PostRoute,
});

function PostRoute() {
	const post = Route.useLoaderData();
	// The piece's own "# Title" becomes the page's headline (what readers
	// made of it rides in the island, see ReaderIsland): its first one,
	// wherever it is (a picture or a quote can come before it).
	const body = post.html.replace(/<h1>[\s\S]*?<\/h1>\n?/, "");
	return (
		<>
		<main className="post">
			<Byline post={post} />
			{/* What this piece responds to: the author's own (a follow-up) or someone else's (a reply). */}
			{post.respondsTo && (
				<p className="post-follows">
					{post.respondsTo.own ? "Follows " : "In reply to "}
					<Link to="/p/$id/$slug" params={{ id: post.respondsTo.id, slug: post.respondsTo.slug }}>
						{post.respondsTo.title}
					</Link>
					{!post.respondsTo.own && (
						<>
							{" by "}
							<Link to="/@{$handle}" params={{ handle: post.respondsTo.author.handle }}>
								{post.respondsTo.author.name}
							</Link>
						</>
					)}
				</p>
			)}
			<h1 className="post-headline">{post.title}</h1>

			{/* The markdown is rendered on the server by @human-tokens/renderer, which
			    escapes any HTML in it; this is the same output as Fold MD's page. */}
			<article className="fold-content post-body" dangerouslySetInnerHTML={{ __html: body }} />
			{post.postscripts.length > 0 && (
				<section id="ps" className="postscripts" aria-label="Postscripts">
					<Postscripts post={post} />
				</section>
			)}
			{post.followUps.length > 0 && (
				<nav className="post-followups" aria-label="Follow-ups">
					<p className="post-followups-label">{post.followUps.length === 1 ? "There's a follow-up" : "There are follow-ups"}</p>
					{post.followUps.map((next) => (
						<Link key={next.id} to="/p/$id/$slug" params={{ id: next.id, slug: next.slug }} className="post-followup">
							{next.title}
							<span aria-hidden="true"> →</span>
						</Link>
					))}
				</nav>
			)}
			{post.replies.length > 0 && (
				<section id="replies" className="post-followups" aria-label="Replies">
					<p className="post-followups-label">{post.replies.length === 1 ? "A reply" : `${post.replies.length} replies`}</p>
					<Replies post={post} />
				</section>
			)}
			{post.viewer?.isAuthor && <DeletePiece post={post} />}
			<BrandMark className="end-mark" />
		</main>
		{/* A series: which part you're in, and the parts, at the foot. */}
		{post.chapters.length > 0 && <SeriesIsland chapters={post.chapters} />}
		</>
	);
}
