import { createFileRoute } from "@tanstack/react-router";
import { pictureResponse } from "../server/images.server";

// /img/<hash>: a picture in a piece, as Fold MD uploaded it (images.server.ts).
export const Route = createFileRoute("/img/$hash")({
	server: {
		handlers: {
			GET: ({ params }) => pictureResponse(params.hash),
		},
	},
});
