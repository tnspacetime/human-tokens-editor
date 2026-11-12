import { createFileRoute, redirect } from "@tanstack/react-router";
import { BrandMark } from "../components/BrandMark";
import { Comments } from "../components/Comments";
import { Qualities } from "../components/Qualities";
import { Byline } from "../components/PostCard";
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
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.title} · Human Tokens` },
					{ name: "description", content: loaderData.excerpt ?? "" },
				]
			: [],
	}),
	component: PostRoute,
});

function PostRoute() {
	const post = Route.useLoaderData();
	return (
		<main className="post">
			<Byline post={post} />
			{/* The markdown is rendered on the server by @human-tokens/renderer, which
			    escapes any HTML in it; this is the same output as Fold MD's page. */}
			<article className="fold-content post-body" dangerouslySetInnerHTML={{ __html: post.html }} />
			<BrandMark className="end-mark" />
			<Qualities post={post} />
			<Comments post={post} />
		</main>
	);
}
